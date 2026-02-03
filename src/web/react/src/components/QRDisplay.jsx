import React, { useState, useEffect, useRef } from 'react';

function QRDisplay() {
  const [qrData, setQrData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [isResetting, setIsResetting] = useState(false);

  // Estados actuales de los toggles (editables)
  const [groupsAIEnabled, setGroupsAIEnabled] = useState(true);
  const [individualAIEnabled, setIndividualAIEnabled] = useState(true);

  // Estados originales de los toggles (guardados)
  const [originalGroupsAIEnabled, setOriginalGroupsAIEnabled] = useState(true);
  const [originalIndividualAIEnabled, setOriginalIndividualAIEnabled] = useState(true);

  const [loadingGroupsAI, setLoadingGroupsAI] = useState(true);
  const [loadingIndividualAI, setLoadingIndividualAI] = useState(true);
  const [savingAll, setSavingAll] = useState(false);

  const qrCanvasRef = useRef(null);
  const intervalRef = useRef(null);
  const qrcodeRef = useRef(null);

  // Estados para el editor de prompts
  const [prompts, setPrompts] = useState({
    individual: '',
    group: ''
  });
  const [originalPrompts, setOriginalPrompts] = useState({
    individual: '',
    group: ''
  });
  const [loadingPrompts, setLoadingPrompts] = useState(true);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [activePromptTab, setActivePromptTab] = useState('individual');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState('success');

  useEffect(() => {
    // Cargar librería QRCode si no está disponible
    if (!window.QRCode) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      script.async = true;
      script.onload = () => {
        checkQR();
        intervalRef.current = setInterval(checkQR, 3000);
      };
      document.body.appendChild(script);
    } else {
      checkQR();
      intervalRef.current = setInterval(checkQR, 3000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    loadGroupsAIConfig();
    loadIndividualAIConfig();
    loadPrompts();
  }, []);

  const loadGroupsAIConfig = async () => {
    try {
      const response = await fetch('/api/system-config/groups_ai_enabled', {
        credentials: 'include'
      });
      const data = await response.json();
      const value = data.value === 'true';
      setGroupsAIEnabled(value);
      setOriginalGroupsAIEnabled(value);
    } catch (error) {
      console.error('Error loading groups AI config:', error);
    } finally {
      setLoadingGroupsAI(false);
    }
  };

  const loadIndividualAIConfig = async () => {
    try {
      const response = await fetch('/api/system-config/individual_ai_enabled', {
        credentials: 'include'
      });
      const data = await response.json();
      const value = data.value === 'true';
      setIndividualAIEnabled(value);
      setOriginalIndividualAIEnabled(value);
    } catch (error) {
      console.error('Error loading individual AI config:', error);
    } finally {
      setLoadingIndividualAI(false);
    }
  };

  const loadPrompts = async () => {
    try {
      const response = await fetch('/api/prompts', {
        credentials: 'include'
      });
      const data = await response.json();
      setPrompts({
        individual: data.individual,
        group: data.group
      });
      setOriginalPrompts({
        individual: data.individual,
        group: data.group
      });
    } catch (error) {
      console.error('Error loading prompts:', error);
      showToastMessage('Error cargando prompts', 'error');
    } finally {
      setLoadingPrompts(false);
    }
  };

  const handleSavePrompt = async (type) => {
    setSavingPrompt(true);
    try {
      const endpoint = type === 'individual' ? '/api/prompts/individual' : '/api/prompts/group';
      const response = await fetch(endpoint, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt: prompts[type] })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setOriginalPrompts(prev => ({
          ...prev,
          [type]: prompts[type]
        }));
        showToastMessage(data.message || 'Prompt guardado correctamente', 'success');
      } else {
        showToastMessage(data.error || 'Error guardando prompt', 'error');
      }
    } catch (error) {
      console.error('Error saving prompt:', error);
      showToastMessage('Error guardando prompt', 'error');
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleCancelPrompt = (type) => {
    setPrompts(prev => ({
      ...prev,
      [type]: originalPrompts[type]
    }));
  };

  const handleSaveAll = async () => {
    setSavingAll(true);

    try {
      // Guardar solo el prompt del tab activo
      const promptEndpoint = activePromptTab === 'individual' ? '/api/prompts/individual' : '/api/prompts/group';
      const promptResponse = await fetch(promptEndpoint, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt: prompts[activePromptTab] })
      });

      const promptData = await promptResponse.json();
      if (!promptResponse.ok || !promptData.success) {
        showToastMessage('Error guardando prompt', 'error');
      } else {
        setOriginalPrompts(prev => ({
          ...prev,
          [activePromptTab]: prompts[activePromptTab]
        }));
        showToastMessage('Prompt guardado correctamente', 'success');
      }
    } catch (error) {
      console.error('Error saving prompt:', error);
      showToastMessage('Error guardando prompt', 'error');
    } finally {
      setSavingAll(false);
    }
  };

  const showToastMessage = (message, type = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const hasIndividualChanges = prompts.individual !== originalPrompts.individual;
  const hasGroupChanges = prompts.group !== originalPrompts.group;
  const hasAnyChanges = hasIndividualChanges || hasGroupChanges;

  const handleDownloadPrompt = (type) => {
    const promptText = originalPrompts[type]; // Usar el original guardado, no el editado
    const fileName = type === 'individual' ? 'prompt-individual.txt' : 'prompt-grupos.txt';

    // Crear blob con el contenido
    const blob = new Blob([promptText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    // Crear link temporal para descargar
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();

    // Limpiar
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToastMessage(`Backup descargado: ${fileName}`, 'success');
  };

  const checkQR = async () => {
    try {
      const response = await fetch('/api/qr');
      const data = await response.json();

      if (data.qr) {
        setStatus('waiting');
        setQrData(data.qr);

        // Generar QR Code
        if (qrCanvasRef.current && window.QRCode) {
          // Limpiar canvas anterior
          qrCanvasRef.current.innerHTML = '';

          // Crear nuevo QR
          qrcodeRef.current = new window.QRCode(qrCanvasRef.current, {
            text: data.qr,
            width: 256,
            height: 256,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: window.QRCode?.CorrectLevel?.M || 0
          });
        }
      } else {
        // Usar el status explícito del backend
        setStatus(data.status === 'connected' ? 'connected' : 'disconnected');
        setQrData(null);
        if (qrCanvasRef.current) {
          qrCanvasRef.current.innerHTML = '';
        }
      }
    } catch (error) {
      console.error('Error obteniendo QR:', error);
      setStatus('error');
    }
  };

  const handleResetSession = async () => {
    if (isResetting) return;

    if (!confirm('¿Estás seguro de que quieres reiniciar la sesión de WhatsApp?')) {
      return;
    }

    setIsResetting(true);
    try {
      const response = await fetch('/api/logout', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        setStatus('waiting');
        setTimeout(checkQR, 3000);
      } else {
        setStatus('error');
      }
    } catch (error) {
      console.error('Error reiniciando sesión:', error);
      setStatus('error');
    } finally {
      setIsResetting(false);
    }
  };

  const handleToggleGroupsAI = async () => {
    const newValue = !groupsAIEnabled;
    setGroupsAIEnabled(newValue);

    try {
      const response = await fetch('/api/system-config/groups-ai-toggle', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: newValue })
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setOriginalGroupsAIEnabled(newValue);
        showToastMessage(newValue ? 'IA en Grupos activada' : 'IA en Grupos desactivada', 'success');
      } else {
        // Revertir el cambio si falla
        setGroupsAIEnabled(!newValue);
        showToastMessage('Error actualizando configuración de IA en Grupos', 'error');
      }
    } catch (error) {
      console.error('Error toggling groups AI:', error);
      setGroupsAIEnabled(!newValue);
      showToastMessage('Error actualizando configuración de IA en Grupos', 'error');
    }
  };

  const handleToggleIndividualAI = async () => {
    const newValue = !individualAIEnabled;
    setIndividualAIEnabled(newValue);

    try {
      const response = await fetch('/api/system-config/individual-ai-toggle', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: newValue })
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setOriginalIndividualAIEnabled(newValue);
        showToastMessage(newValue ? 'IA Individual activada' : 'IA Individual desactivada', 'success');
      } else {
        // Revertir el cambio si falla
        setIndividualAIEnabled(!newValue);
        showToastMessage('Error actualizando configuración de IA Individual', 'error');
      }
    } catch (error) {
      console.error('Error toggling individual AI:', error);
      setIndividualAIEnabled(!newValue);
      showToastMessage('Error actualizando configuración de IA Individual', 'error');
    }
  };

  return (
    <div className="flex-1 flex gap-6 p-8 overflow-auto" style={{ background: '#FAFBFC' }}>
      {/* Columna 1: Sesión de WhatsApp */}
      <div className="flex-1 flex flex-col">
        <div className="bg-white rounded-2xl p-8 h-full" style={{
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
          border: '1px solid #E8EBED'
        }}>
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-gray-800 mb-2">
              Sesión de WhatsApp
            </h1>
            <p className="text-sm text-gray-500">
              Escanea el código QR para vincular tu dispositivo
            </p>
          </div>

        {/* QR Area */}
        <div className="rounded-xl p-8 flex items-center justify-center min-h-[320px]" style={{
          background: '#FAFBFC',
          border: '1px solid #E8EBED'
        }}>
          {status === 'loading' && (
            <div className="flex flex-col items-center space-y-4">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 border-t-purple-600"></div>
              <p className="text-sm text-gray-600">Generando código QR...</p>
            </div>
          )}

          {status === 'waiting' && qrData && (
            <div className="flex flex-col items-center">
              <div ref={qrCanvasRef} className="flex items-center justify-center bg-white p-4 rounded-xl" style={{
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
              }}></div>
              <p className="text-xs text-gray-500 mt-4">Código válido por 60 segundos</p>
            </div>
          )}

          {status === 'connected' && (
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-4" style={{
                background: 'rgba(34, 197, 94, 0.1)'
              }}>
                <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-semibold text-gray-800 mb-1">
                Conectado
              </p>
              <p className="text-sm text-gray-500">
                Tu sesión está activa
              </p>
            </div>
          )}

          {status === 'disconnected' && (
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-4" style={{
                background: 'rgba(245, 158, 11, 0.1)'
              }}>
                <svg className="w-10 h-10 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <p className="text-lg font-semibold text-gray-800 mb-1">
                Desconectado
              </p>
              <p className="text-sm text-gray-500">
                Esperando código QR...
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-4" style={{
                background: 'rgba(239, 68, 68, 0.1)'
              }}>
                <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-lg font-semibold text-gray-800 mb-1">
                Error de conexión
              </p>
              <p className="text-sm text-gray-500">
                Intenta reiniciar la sesión
              </p>
            </div>
          )}
        </div>

        {/* Alerts */}
        <div className="mt-6">
          {status === 'waiting' && (
            <div className="rounded-xl px-4 py-3 text-sm mb-4" style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.2)',
              color: '#92400E'
            }}>
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <span>Abre WhatsApp y escanea el código</span>
              </div>
            </div>
          )}

          {status === 'connected' && (
            <div className="rounded-xl px-4 py-3 text-sm mb-4" style={{
              background: 'rgba(34, 197, 94, 0.08)',
              border: '1px solid rgba(34, 197, 94, 0.2)',
              color: '#166534'
            }}>
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Bot conectado y funcionando correctamente</span>
              </div>
            </div>
          )}

          {status === 'disconnected' && (
            <div className="rounded-xl px-4 py-3 text-sm mb-4" style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.2)',
              color: '#92400E'
            }}>
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <span>Sesión no vinculada. Haz clic en "Reiniciar Sesión" para generar un nuevo código QR</span>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="rounded-xl px-4 py-3 text-sm mb-4" style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              color: '#991B1B'
            }}>
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <span>No se pudo obtener el código QR</span>
              </div>
            </div>
          )}

          {/* Reset Button */}
          <button
            onClick={handleResetSession}
            disabled={isResetting}
            className="w-full px-4 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{
              background: '#5c19e3',
              color: 'white'
            }}
            onMouseEnter={(e) => !isResetting && (e.target.style.background = '#4c10d4')}
            onMouseLeave={(e) => !isResetting && (e.target.style.background = '#5c19e3')}
          >
            {isResetting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                <span>Reiniciando...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Reiniciar Sesión</span>
              </>
            )}
          </button>
        </div>

          {/* Instructions */}
          <div className="mt-6 pt-6 rounded-xl p-4" style={{
            background: '#FAFBFC',
            border: '1px solid #E8EBED'
          }}>
            <p className="text-xs font-semibold text-gray-700 mb-3">Cómo vincular:</p>
            <ol className="space-y-2 text-xs text-gray-600">
              <li className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold text-white" style={{ background: '#5c19e3' }}>1</span>
                <span>Abre WhatsApp en tu teléfono</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold text-white" style={{ background: '#5c19e3' }}>2</span>
                <span>Ve a Configuración → Dispositivos vinculados</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold text-white" style={{ background: '#5c19e3' }}>3</span>
                <span>Toca "Vincular dispositivo"</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold text-white" style={{ background: '#5c19e3' }}>4</span>
                <span>Escanea el código QR mostrado arriba</span>
              </li>
            </ol>
          </div>
        </div>
      </div>

      {/* Columna 2: Configuración de Prompts */}
      <div className="flex-1 flex flex-col">
        <div className="bg-white rounded-2xl p-8 h-full flex flex-col" style={{
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
          border: '1px solid #E8EBED'
        }}>
          {/* Header with Toggle */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-2xl font-semibold text-gray-800 mb-2">
                  Configuración de IA
                </h2>
                <p className="text-sm text-gray-500">
                  Personaliza el comportamiento de la IA
                </p>
              </div>
              {/* Conditional AI Toggle based on active tab */}
              {activePromptTab === 'group' ? (
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs font-semibold text-gray-700">IA en Grupos</p>
                    <p className="text-[10px] text-gray-400">
                      {groupsAIEnabled ? 'Activada' : 'Desactivada'}
                    </p>
                  </div>
                  <button
                    onClick={handleToggleGroupsAI}
                    disabled={loadingGroupsAI}
                    className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: groupsAIEnabled ? '#5c19e3' : '#E8EBED'
                    }}
                  >
                    <span
                      className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                      style={{
                        transform: groupsAIEnabled ? 'translateX(20px)' : 'translateX(0)'
                      }}
                    />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs font-semibold text-gray-700">IA Individual</p>
                    <p className="text-[10px] text-gray-400">
                      {individualAIEnabled ? 'Activada' : 'Desactivada'}
                    </p>
                  </div>
                  <button
                    onClick={handleToggleIndividualAI}
                    disabled={loadingIndividualAI}
                    className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: individualAIEnabled ? '#5c19e3' : '#E8EBED'
                    }}
                  >
                    <span
                      className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                      style={{
                        transform: individualAIEnabled ? 'translateX(20px)' : 'translateX(0)'
                      }}
                    />
                  </button>
                </div>
              )}
            </div>

            {/* Download Backup Button */}
            <div className="flex justify-end">
              <button
                onClick={() => handleDownloadPrompt(activePromptTab)}
                disabled={loadingPrompts}
                className="px-4 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                style={{
                  background: '#F3F4F6',
                  color: '#374151'
                }}
                onMouseEnter={(e) => !loadingPrompts && (e.target.style.background = '#E5E7EB')}
                onMouseLeave={(e) => !loadingPrompts && (e.target.style.background = '#F3F4F6')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Descargar Backup</span>
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6 border-b" style={{ borderColor: '#E8EBED' }}>
            <button
              onClick={() => setActivePromptTab('individual')}
              className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                activePromptTab === 'individual' ? 'text-gray-800' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Chats Individuales
              {hasIndividualChanges && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-orange-500"></span>
              )}
              {activePromptTab === 'individual' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: '#5c19e3' }}></div>
              )}
            </button>
            <button
              onClick={() => setActivePromptTab('group')}
              className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                activePromptTab === 'group' ? 'text-gray-800' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Grupos
              {hasGroupChanges && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-orange-500"></span>
              )}
              {activePromptTab === 'group' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: '#5c19e3' }}></div>
              )}
            </button>
          </div>

          {loadingPrompts ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-purple-600"></div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col">
              {/* Editor */}
              <div className="flex-1 mb-4">
                <textarea
                  value={prompts[activePromptTab]}
                  onChange={(e) => setPrompts(prev => ({
                    ...prev,
                    [activePromptTab]: e.target.value
                  }))}
                  className="w-full h-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent font-mono resize-none"
                  style={{
                    borderColor: '#E8EBED',
                    background: '#FAFBFC',
                    minHeight: '400px'
                  }}
                  placeholder={`Escribe el prompt del sistema para ${activePromptTab === 'individual' ? 'chats individuales' : 'grupos'}...`}
                />
              </div>

              {/* Actions */}
              {(hasIndividualChanges && activePromptTab === 'individual') || (hasGroupChanges && activePromptTab === 'group') ? (
                <div className="flex gap-3">
                  <button
                    onClick={handleSaveAll}
                    disabled={savingAll}
                    className="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    style={{
                      background: '#5c19e3',
                      color: 'white'
                    }}
                    onMouseEnter={(e) => !savingAll && (e.target.style.background = '#4c10d4')}
                    onMouseLeave={(e) => !savingAll && (e.target.style.background = '#5c19e3')}
                  >
                    {savingAll ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                        <span>Guardando...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>Guardar Prompt</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handleCancelPrompt(activePromptTab)}
                    disabled={savingAll}
                    className="px-6 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: '#E8EBED',
                      color: '#6B7280'
                    }}
                    onMouseEnter={(e) => !savingAll && (e.target.style.background = '#D1D5DB')}
                    onMouseLeave={(e) => !savingAll && (e.target.style.background = '#E8EBED')}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="rounded-xl px-4 py-3 text-sm" style={{
                  background: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                  color: '#166534'
                }}>
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>Todos los cambios guardados</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Toast Notification */}
      {showToast && (
        <div
          className="fixed bottom-8 right-8 px-6 py-4 rounded-xl shadow-lg flex items-center gap-3 animate-slide-up"
          style={{
            background: toastType === 'success' ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 68, 68, 0.95)',
            color: 'white',
            maxWidth: '400px',
            zIndex: 9999
          }}
        >
          {toastType === 'success' ? (
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          )}
          <p className="text-sm font-medium">{toastMessage}</p>
        </div>
      )}

      <style>{`
        @keyframes slide-up {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}

export default QRDisplay;
