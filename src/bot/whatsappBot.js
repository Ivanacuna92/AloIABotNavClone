const makeWASocket = require('baileys').default;
const { DisconnectReason, useMultiFileAuthState, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = require('baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const config = require('../config/config');
const logger = require('../services/logger');
const aiService = require('../services/aiService');
const sessionManager = require('../services/sessionManager');
const promptLoader = require('../services/promptLoader');
const humanModeManager = require('../services/humanModeManager');
const followUpService = require('../services/followUpService');
const systemConfigService = require('../services/systemConfigService');

// Helper para extraer userId limpio de diferentes formatos de WhatsApp
function extractUserId(remoteJid) {
    if (!remoteJid) return '';
    return remoteJid
        .replace('@s.whatsapp.net', '')
        .replace('@lid', '')
        .replace('@g.us', '');
}

class WhatsAppBot {
    constructor() {
        this.sock = null;
        this.currentQR = null;
        this.connectionStatus = 'disconnected'; // 'disconnected', 'connecting', 'connected'
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.isReconnecting = false;
    }

    async start() {
        if (this.isReconnecting) {
            console.log('Ya hay un intento de reconexión en progreso...');
            return;
        }
        
        this.isReconnecting = true;
        console.log('Iniciando bot de WhatsApp con Baileys...');
        config.validateApiKey();
        
        try {
            // Asegurar que la carpeta auth_baileys existe con permisos correctos
            const authPath = path.join(process.cwd(), 'auth_baileys');
            if (!fs.existsSync(authPath)) {
                fs.mkdirSync(authPath, { recursive: true, mode: 0o755 });
                console.log('Carpeta auth_baileys creada con permisos correctos');
            }

            // Configurar autenticación multi-archivo
            const { state, saveCreds } = await useMultiFileAuthState('./auth_baileys');
            
            // Obtener versión más reciente de Baileys
            const { version, isLatest } = await fetchLatestBaileysVersion();
            console.log(`Usando versión de WhatsApp Web: ${version.join('.')} (última: ${isLatest})`);
            
            // Store no es necesario en baileys v6
            
            // Crear socket de WhatsApp con configuración mejorada para producción
            this.sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: ['Chrome (Linux)', '', ''],
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
                getMessage: async () => {
                    return { conversation: 'No disponible' };
                },
                defaultQueryTimeoutMs: undefined,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                qrTimeout: undefined,
                markOnlineOnConnect: false,
                msgRetryCounterCache: new Map(),
                retryRequestDelayMs: 250,
                maxMsgRetryCount: 5
            });
            
        
        // Guardar credenciales cuando se actualicen
        this.sock.ev.on('creds.update', saveCreds);
        
        // Manejar actualizaciones de conexión
        this.sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('Escanea este código QR con WhatsApp:');
                console.log('O visita: http://tu-servidor:4242/qr');
                this.currentQR = qr;
                this.connectionStatus = 'connecting';
                qrcode.generate(qr, { small: true });
            }
            
            if (connection === 'close') {
                this.connectionStatus = 'disconnected';
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log('Conexión cerrada debido a', lastDisconnect?.error, ', reconectando:', shouldReconnect);
                
                // Si es error 405 o 401, limpiar sesión y reiniciar con límite
                if (statusCode === 405 || statusCode === 401 || statusCode === 403) {
                    this.reconnectAttempts++;
                    
                    if (this.reconnectAttempts > this.maxReconnectAttempts) {
                        console.log('❌ Máximo de intentos de reconexión alcanzado. Por favor usa el botón de reiniciar sesión en /qr');
                        this.isReconnecting = false;
                        return;
                    }
                    
                    console.log(`Error ${statusCode} detectado. Intento ${this.reconnectAttempts}/${this.maxReconnectAttempts}. Limpiando sesión...`);
                    this.clearSession();
                    
                    this.isReconnecting = false;
                    setTimeout(() => this.start(), 5000);
                } else if (shouldReconnect && statusCode !== DisconnectReason.loggedOut) {
                    this.reconnectAttempts = 0;
                    this.isReconnecting = false;
                    setTimeout(() => this.start(), 5000);
                } else {
                    this.isReconnecting = false;
                }
            } else if (connection === 'open') {
                console.log('¡Bot de WhatsApp conectado y listo!');
                this.currentQR = null;
                this.connectionStatus = 'connected';
                this.reconnectAttempts = 0;
                this.isReconnecting = false;
                logger.log('SYSTEM', 'Bot iniciado correctamente con Baileys');
                sessionManager.startCleanupTimer(this.sock);
                followUpService.startFollowUpTimer(this.sock);
            }
        });

        // Manejar actualizaciones de estado de mensajes
        this.sock.ev.on('messages.update', async (updates) => {
            for (const update of updates) {
                try {
                    const messageId = update.key.id;
                    const userId = extractUserId(update.key.remoteJid);

                    // Log para debugging
                    console.log('📱 Update recibido:', JSON.stringify(update, null, 2));

                    // Determinar el estado según el update
                    let status = null;

                    // Status codes de WhatsApp:
                    // 1 = sent (enviado al servidor)
                    // 2 = delivered (entregado al dispositivo)
                    // 3 = played (mensaje de voz reproducido o estado intermedio)
                    // 4 = read (leído - checks azules)

                    if (update.update.status === 4) {
                        status = 'read'; // Mensaje leído (checks azules)
                        console.log('🔵 LEÍDO detectado - Status 4');
                    } else if (update.update.status === 2) {
                        status = 'delivered'; // Mensaje entregado (double check gris)
                        console.log('⚪ ENTREGADO detectado - Status 2');
                    } else if (update.update.status === 1) {
                        status = 'sent'; // Mensaje enviado (single check)
                        console.log('⚪ ENVIADO detectado - Status 1');
                    }
                    // Ignorar status 3 (estado intermedio/voz reproducida)

                    if (status && messageId) {
                        await logger.updateMessageStatus(messageId, status);
                        console.log(`✅ Estado actualizado: ${messageId} -> ${status} (Usuario: ${userId})`);
                    }
                } catch (error) {
                    console.error('Error actualizando estado de mensaje:', error);
                }
            }
        });

        // Manejar mensajes entrantes
        this.sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg.message) return;
                
                // Log para debugging
                console.log('Mensaje recibido - fromMe:', msg.key.fromMe, 'remoteJid:', msg.key.remoteJid);
                console.log('DEBUG msg.key completo:', JSON.stringify(msg.key, null, 2));
                console.log('DEBUG pushName:', msg.pushName);
                console.log('DEBUG verifiedBizName:', msg.verifiedBizName);
                
                // Ignorar mensajes propios
                if (msg.key.fromMe) {
                    console.log('Ignorando mensaje propio');
                    return;
                }
                
                // Obtener el número del remitente
                const from = msg.key.remoteJid;
                const isGroup = from.endsWith('@g.us');
                
                // Obtener el texto del mensaje
                const conversation = msg.message.conversation || 
                                   msg.message.extendedTextMessage?.text || 
                                   '';
                
                // Ignorar mensajes sin texto
                if (!conversation || conversation.trim() === '') {
                    console.log('Mensaje ignorado - Sin contenido de texto');
                    return;
                }
                
                // Extraer información del usuario o grupo
                let userId, userName, groupName;

                if (isGroup) {
                    // Para grupos: usar el ID del grupo como userId
                    userId = from.replace('@g.us', '');
                    groupName = 'Grupo'; // Nombre por defecto, se puede mejorar obteniendo metadata
                    userName = msg.pushName || 'Participante';

                    // Obtener metadata del grupo para nombre real
                    try {
                        const groupMetadata = await this.sock.groupMetadata(from);
                        groupName = groupMetadata.subject || 'Grupo sin nombre';
                    } catch (error) {
                        console.log('No se pudo obtener metadata del grupo:', error.message);
                    }

                    await logger.log('cliente', conversation, userId, groupName, isGroup);

                    // Los grupos ahora funcionan igual que los chats privados
                    // No se activa soporte automáticamente, el usuario decide si usar IA o modo manual
                } else {
                    // Para chats privados (soporta @s.whatsapp.net y @lid de WhatsApp Business)
                    // Usar senderPn si está disponible (número real en WhatsApp Business)
                    const realPhone = msg.key.senderPn || from;
                    userId = extractUserId(realPhone);
                    userName = msg.pushName || userId;

                    await logger.log('cliente', conversation, userId, userName, isGroup);
                }

                // Verificar si está en modo humano o soporte
                const isHuman = await humanModeManager.isHumanMode(userId);
                const isSupport = await humanModeManager.isSupportMode(userId);

                if (isHuman || isSupport) {
                    const mode = isSupport ? 'SOPORTE' : 'HUMANO';
                    await logger.log('SYSTEM', `Mensaje ignorado - Modo ${mode} activo para ${userName} (${userId})`);
                    return;
                }

                // Verificar si la IA está desactivada para grupos
                if (isGroup) {
                    const groupsAIEnabled = await systemConfigService.isGroupsAIEnabled();
                    if (!groupsAIEnabled) {
                        await logger.log('SYSTEM', `Mensaje de grupo ignorado - IA en grupos desactivada (${groupName})`);
                        return;
                    }
                } else {
                    // Verificar si la IA está desactivada para chats individuales
                    const individualAIEnabled = await systemConfigService.isIndividualAIEnabled();
                    if (!individualAIEnabled) {
                        await logger.log('SYSTEM', `Mensaje individual ignorado - IA individual desactivada (${userName})`);
                        return;
                    }
                }

                // Si hay seguimiento activo, cancelarlo (el cliente respondió)
                if (followUpService.hasActiveFollowUp(userId)) {
                    await followUpService.cancelFollowUp(userId, 'Cliente respondió');
                }

                // Procesar mensaje y generar respuesta
                const response = await this.processMessage(userId, conversation, from);

                // Analizar respuesta del usuario para detectar aceptación, rechazo o frustración
                const session = await sessionManager.getSession(userId, from);
                const analysisResult = await followUpService.analyzeUserResponse(
                    userId,
                    conversation,
                    session.messages
                );

                // Enviar respuesta y capturar messageId
                const sentMsg = await this.sock.sendMessage(from, { text: response });
                const messageId = sentMsg?.key?.id;
                const displayName = isGroup ? groupName : userName;
                await logger.log('bot', response, userId, displayName, isGroup, null, null, messageId);
                
            } catch (error) {
                await this.handleError(error, m.messages[0]);
            }
        });

        } catch (error) {
            console.error('Error iniciando bot:', error);
            this.isReconnecting = false;

            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                console.log(`Reintentando en 5 segundos... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                setTimeout(() => this.start(), 5000);
            }
        }
    }

    async processMessage(userId, userMessage, chatId) {
        // Agregar mensaje del usuario a la sesión
        await sessionManager.addMessage(userId, 'user', userMessage, chatId);

        // Determinar si es un grupo basándose en el chatId
        const isGroup = chatId.endsWith('@g.us');

        // Obtener el prompt apropiado según el tipo de chat
        const systemPrompt = promptLoader.getPrompt(isGroup);

        // Preparar mensajes para la IA
        const messages = [
            { role: 'system', content: systemPrompt },
            ...(await sessionManager.getMessages(userId, chatId))
        ];

        // Generar respuesta con IA
        const aiResponse = await aiService.generateResponse(messages);

        // Verificar si la respuesta contiene el marcador de activar soporte
        if (aiResponse.includes('{{ACTIVAR_SOPORTE}}')) {
            // Remover el marcador de la respuesta
            const cleanResponse = aiResponse.replace('{{ACTIVAR_SOPORTE}}', '').trim();

            // Activar modo soporte
            await humanModeManager.setMode(userId, 'support');
            await sessionManager.updateSessionMode(userId, chatId, 'support');

            // Agregar respuesta limpia a la sesión
            await sessionManager.addMessage(userId, 'assistant', cleanResponse, chatId);

            // Registrar en logs
            await logger.log('SYSTEM', `Modo SOPORTE activado automáticamente para ${userId}`);

            return cleanResponse;
        }

        // Agregar respuesta de IA a la sesión
        await sessionManager.addMessage(userId, 'assistant', aiResponse, chatId);

        return aiResponse;
    }
    
    async handleError(error, message) {
        console.error('Error procesando mensaje:', error);
        
        const from = message.key.remoteJid;
        const userId = extractUserId(from);
        
        let errorMessage = 'Lo siento, ocurrió un error. Inténtalo de nuevo.';
        
        if (error.message.includes('autenticación') || error.message.includes('API key')) {
            errorMessage = 'Error de configuración del bot. Por favor, contacta al administrador.';
        }
        
        try {
            await this.sock.sendMessage(from, { text: errorMessage });
            logger.log('ERROR', error.message, userId);
        } catch (sendError) {
            console.error('Error enviando mensaje de error:', sendError);
        }
    }
    
    async stop() {
        console.log('Cerrando bot...');
        if (this.sock) {
            this.sock.end();
        }
    }
    
    async clearSession() {
        const authPath = path.join(process.cwd(), 'auth_baileys');
        
        try {
            await fsPromises.rm(authPath, { recursive: true, force: true });
            console.log('Sesión eliminada correctamente');
        } catch (err) {
            console.log('No había sesión previa o ya fue eliminada');
        }
    }
    
    async logout() {
        console.log('Cerrando sesión de WhatsApp...');
        try {
            this.connectionStatus = 'disconnected';
            this.currentQR = null;
            this.reconnectAttempts = 0;
            this.isReconnecting = false;
            
            if (this.sock) {
                try {
                    await this.sock.logout();
                } catch (err) {
                    console.log('Error al hacer logout:', err.message);
                }
            }
            
            await this.clearSession();
            
            // Reiniciar el bot para generar nuevo QR
            setTimeout(() => this.start(), 2000);
            return true;
        } catch (error) {
            console.error('Error al cerrar sesión:', error);
            return false;
        }
    }
}

module.exports = WhatsAppBot;