import React, { useState, useEffect } from 'react';
import { getReports, updateSaleStatus, analyzeConversation } from '../services/api';

function Reports() {
  const [reports, setReports] = useState([]);
  const [selectedDate, setSelectedDate] = useState('all'); // Cambiar default a 'all' para ver todos
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState({ current: 0, total: 0 });
  const [editingId, setEditingId] = useState(null);
  const [filters, setFilters] = useState({
    phone: '',
    status: 'all',
    hasSale: 'all',
    hasAppointment: 'all',
    chatType: 'all' // all, individual, group
  });
  const [filteredReports, setFilteredReports] = useState([]);
  const [pendingAnalysis, setPendingAnalysis] = useState(null);
  const [analyzedIds, setAnalyzedIds] = useState(new Set());

  useEffect(() => {
    loadReports();
    // Cargar análisis pendiente de localStorage
    const savedAnalysis = localStorage.getItem('pendingAnalysis');
    if (savedAnalysis) {
      const analysis = JSON.parse(savedAnalysis);
      setPendingAnalysis(analysis);
      setAnalyzedIds(new Set(analysis.analyzedIds || []));
    }
  }, [selectedDate]);

  useEffect(() => {
    applyFilters();
  }, [reports, filters]);

  // Guardar estado del análisis cuando cambie
  useEffect(() => {
    if (pendingAnalysis) {
      localStorage.setItem('pendingAnalysis', JSON.stringify({
        ...pendingAnalysis,
        analyzedIds: Array.from(analyzedIds)
      }));
    }
  }, [pendingAnalysis, analyzedIds]);

  // Limpiar al desmontar el componente si no hay análisis en progreso
  useEffect(() => {
    return () => {
      if (!analyzing) {
        localStorage.removeItem('pendingAnalysis');
      }
    };
  }, [analyzing]);

  const applyFilters = () => {
    let filtered = [...reports];

    // Filtrar por teléfono
    if (filters.phone) {
      filtered = filtered.filter(r => 
        r.telefono.includes(filters.phone)
      );
    }

    // Filtrar por estado
    if (filters.status !== 'all') {
      filtered = filtered.filter(r => {
        if (filters.status === 'human') return r.modoHumano;
        if (filters.status === 'support') return r.soporteActivado;
        if (filters.status === 'ai') return !r.modoHumano && !r.soporteActivado;
        return true;
      });
    }

    // Filtrar por ventas
    if (filters.hasSale !== 'all') {
      const hasSale = filters.hasSale === 'yes';
      filtered = filtered.filter(r => 
        (r.posibleVenta || r.ventaCerrada) === hasSale
      );
    }

    // Filtrar por citas
    if (filters.hasAppointment !== 'all') {
      const hasAppointment = filters.hasAppointment === 'yes';
      filtered = filtered.filter(r => r.citaAgendada === hasAppointment);
    }

    // Filtrar por tipo de chat (individual o grupo)
    if (filters.chatType !== 'all') {
      const isGroup = filters.chatType === 'group';
      filtered = filtered.filter(r => Boolean(r.isGroup) === isGroup);
    }

    setFilteredReports(filtered);
  };

  const loadReports = async () => {
    setLoading(true);
    try {
      // Si es una fecha específica (formato YYYY-MM-DD), usar el valor directamente
      // Si no, pasar el valor especial (month, week, today, yesterday)
      const dateToSend = selectedDate.includes('-') ? selectedDate : selectedDate;
      const data = await getReports(dateToSend);
      setReports(data);
    } catch (error) {
      console.error('Error cargando reportes:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaleStatusChange = async (report, field, value) => {
    try {
      // Generar el ID de conversación basado en teléfono y fecha
      const phone = report.telefono.replace('@s.whatsapp.net', '').replace('@lid', '');
      const date = report.fecha;
      
      await updateSaleStatus(null, { 
        phone,
        date,
        [field]: value 
      });
      
      setReports(reports.map(r => 
        r.id === report.id ? { ...r, [field]: value } : r
      ));
      setEditingId(null);
    } catch (error) {
      console.error('Error actualizando estado de venta:', error);
    }
  };

  const formatPhone = (phone) => {
    // Remover @s.whatsapp.net si existe
    return phone.replace('@s.whatsapp.net', '').replace('@lid', '');
  };

  const getStatusBadge = (report) => {
    if (report.ventaCerrada || report.analizadoIA) {
      return <span className="px-2 py-1 text-xs rounded-full" style={{ background: 'rgba(92, 25, 227, 0.1)', color: '#5c19e3' }}>Analizado con IA</span>;
    }
    if (report.citaAgendada) {
      return <span className="px-2 py-1 text-xs rounded-full" style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#16A34A' }}>Cita Agendada</span>;
    }
    if (report.posibleVenta) {
      return <span className="px-2 py-1 text-xs rounded-full" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3B82F6' }}>Posible Venta</span>;
    }
    if (report.soporteActivado) {
      return <span className="px-2 py-1 text-xs rounded-full" style={{ background: 'rgba(249, 115, 22, 0.1)', color: '#F97316' }}>Soporte</span>;
    }
    return <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800">Normal</span>;
  };

  const reAnalyzeAll = async () => {
    if (confirm('¿Estás seguro de que deseas volver a analizar TODAS las conversaciones? Esto sobrescribirá los resultados existentes.')) {
      // Limpiar localStorage y estado
      localStorage.removeItem('pendingAnalysis');
      setPendingAnalysis(null);
      setAnalyzedIds(new Set());
      
      // Resetear análisis en el backend
      try {
        setLoading(true);
        // Llamar endpoint para resetear análisis si existe, o simplemente continuar
        await analyzeAllConversations(false, true); // true = forceReanalyze
      } catch (error) {
        console.error('Error resetting analysis:', error);
      } finally {
        setLoading(false);
      }
    }
  };

  const analyzeAllConversations = async (resume = false, forceReanalyze = false) => {
    setAnalyzing(true);
    
    // Si estamos reanudando, usar los IDs ya analizados (excepto si es re-análisis forzado)
    let alreadyAnalyzed = resume && pendingAnalysis && !forceReanalyze ? new Set(analyzedIds) : new Set();
    
    // Filtrar conversaciones que no han sido analizadas (o todas si es re-análisis forzado)
    const conversationsToAnalyze = filteredReports.filter(r => 
      r.conversacion && 
      r.conversacion.length > 0 && 
      (forceReanalyze || !alreadyAnalyzed.has(r.id))
    );
    
    const totalToAnalyze = conversationsToAnalyze.length + alreadyAnalyzed.size;
    setAnalyzeProgress({ current: alreadyAnalyzed.size, total: totalToAnalyze });
    
    // Guardar estado inicial del análisis
    setPendingAnalysis({
      startDate: new Date().toISOString(),
      totalReports: totalToAnalyze,
      analyzedIds: Array.from(alreadyAnalyzed)
    });
    
    try {
      for (let i = 0; i < conversationsToAnalyze.length; i++) {
        const report = conversationsToAnalyze[i];
        
        // Actualizar progreso
        const currentProgress = alreadyAnalyzed.size + i + 1;
        setAnalyzeProgress({ current: currentProgress, total: totalToAnalyze });
        
        // Marcar esta conversación como "analizando" en ambos estados
        const markAsAnalyzing = (r) => 
          r.id === report.id ? { ...r, isAnalyzing: true } : r;
        
        setReports(prev => prev.map(markAsAnalyzing));
        setFilteredReports(prev => prev.map(markAsAnalyzing));
        
        try {
          const analysis = await analyzeConversation(report.conversacion);
          
          // Actualizar el estado en el backend INMEDIATAMENTE
          await updateSaleStatus(null, {
            phone: report.telefono.replace('@s.whatsapp.net', '').replace('@lid', ''),
            date: report.fecha,
            posibleVenta: analysis.posibleVenta,
            ventaCerrada: true, // Marcamos como analizado
            citaAgendada: analysis.citaAgendada
          });

          // Actualizar el estado local y quitar marca de analizando en ambos estados
          const updateWithAnalysis = (r) => 
            r.id === report.id 
              ? { ...r, ...analysis, isAnalyzing: false, analyzed: true }
              : r;
          
          setReports(prev => prev.map(updateWithAnalysis));
          setFilteredReports(prev => prev.map(updateWithAnalysis));
          
          // Agregar a la lista de analizados
          setAnalyzedIds(prev => {
            const newSet = new Set(prev);
            newSet.add(report.id);
            return newSet;
          });
          
          // Actualizar estado del análisis pendiente
          setPendingAnalysis(prev => ({
            ...prev,
            analyzedIds: [...(prev?.analyzedIds || []), report.id]
          }));
          
        } catch (analysisError) {
          console.error(`Error analizando conversación ${report.id}:`, analysisError);
          // Continuar con el siguiente aunque este falle
        }

        // Pequeña pausa entre análisis
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Limpiar localStorage al completar
      localStorage.removeItem('pendingAnalysis');
      setPendingAnalysis(null);
      
      // Recargar reportes para obtener datos actualizados del servidor
      await loadReports();
      
    } catch (error) {
      console.error('Error analizando conversaciones:', error);
      alert('Error al analizar conversaciones. Los datos analizados hasta ahora se han guardado.');
      // NO limpiar los IDs analizados, mantenerlos para poder reanudar
    } finally {
      setAnalyzing(false);
      // No limpiar el progreso inmediatamente para que el usuario vea que se completó
      setTimeout(() => {
        setAnalyzeProgress({ current: 0, total: 0 });
      }, 2000);
    }
  };

  const exportToCSV = () => {
    const headers = ['ID', 'Fecha', 'Hora', 'Teléfono', 'Mensajes', 'Posible Venta', 'Analizado con IA', 'Cita Agendada', 'Soporte'];
    const csvContent = [
      headers.join(','),
      ...reports.map(r => [
        r.id,
        r.fecha,
        r.hora,
        formatPhone(r.telefono),
        r.mensajes,
        r.posibleVenta ? 'Sí' : 'No',
        (r.ventaCerrada || r.analizadoIA) ? 'Sí' : 'No',
        r.citaAgendada ? 'Sí' : 'No',
        r.soporteActivado ? 'Sí' : 'No'
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `reporte_${selectedDate}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-8 max-w-full overflow-auto" style={{ background: '#FAFBFC', minHeight: '100vh' }}>
      <div className="bg-white rounded-2xl p-6" style={{
        border: '1px solid #E8EBED',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
      }}>
        <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold text-gray-800">Reporte de Conversaciones</h2>
        <div className="flex gap-4 items-center">
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-4 py-2 border rounded-xl focus:outline-none transition-all text-sm"
            style={{ borderColor: '#E8EBED' }}
            onFocus={(e) => {
              e.target.style.borderColor = '#5c19e3';
              e.target.style.boxShadow = '0 0 0 3px rgba(92, 25, 227, 0.08)';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = '#E8EBED';
              e.target.style.boxShadow = 'none';
            }}
          >
            <option value="all">Todos los registros</option>
            <option value="month">Este mes</option>
            <option value="week">Esta semana</option>
            <option value="today">Hoy</option>
            <option value="yesterday">Ayer</option>
            <option value="custom">Fecha específica</option>
          </select>
          {selectedDate === 'custom' && (
            <input
              type="date"
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-4 py-2 border rounded-xl focus:outline-none transition-all text-sm"
              style={{ borderColor: '#E8EBED' }}
              onFocus={(e) => {
                e.target.style.borderColor = '#5c19e3';
                e.target.style.boxShadow = '0 0 0 3px rgba(92, 25, 227, 0.08)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#E8EBED';
                e.target.style.boxShadow = 'none';
              }}
            />
          )}
          {pendingAnalysis && !analyzing && (
            <button
              onClick={() => analyzeAllConversations(true)}
              className="px-4 py-2 text-white rounded-xl transition-all mr-2 min-w-[180px] text-sm font-medium disabled:opacity-50"
              style={{ background: '#F59E0B' }}
              onMouseEnter={(e) => {
                e.target.style.background = '#D97706';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = '#F59E0B';
              }}
            >
              Reanudar Análisis ({analyzedIds.size} completados)
            </button>
          )}
          <button
            onClick={() => analyzeAllConversations(false)}
            className="px-4 py-2 text-white rounded-xl transition-all mr-2 min-w-[180px] text-sm font-medium disabled:opacity-50"
            style={{ background: '#5c19e3' }}
            onMouseEnter={(e) => {
              if (!e.target.disabled) {
                e.target.style.background = '#4c10d4';
              }
            }}
            onMouseLeave={(e) => {
              if (!e.target.disabled) {
                e.target.style.background = '#5c19e3';
              }
            }}
            disabled={reports.length === 0 || analyzing}
          >
            {analyzing
              ? `Analizando... ${analyzeProgress.current}/${analyzeProgress.total}`
              : pendingAnalysis ? 'Nuevo Análisis' : 'Analizar con IA'}
          </button>
          <button
            onClick={reAnalyzeAll}
            className="px-4 py-2 text-white rounded-xl transition-all mr-2 min-w-[180px] text-sm font-medium disabled:opacity-50"
            style={{ background: '#F97316' }}
            onMouseEnter={(e) => {
              if (!e.target.disabled) {
                e.target.style.background = '#EA580C';
              }
            }}
            onMouseLeave={(e) => {
              if (!e.target.disabled) {
                e.target.style.background = '#F97316';
              }
            }}
            disabled={reports.length === 0 || analyzing}
          >
            Volver a analizar con IA
          </button>
          <button
            onClick={exportToCSV}
            className="px-4 py-2 text-white rounded-xl transition-all text-sm font-medium disabled:opacity-50"
            style={{ background: '#6B7280' }}
            onMouseEnter={(e) => {
              if (!e.target.disabled) {
                e.target.style.background = '#4B5563';
              }
            }}
            onMouseLeave={(e) => {
              if (!e.target.disabled) {
                e.target.style.background = '#6B7280';
              }
            }}
            disabled={reports.length === 0}
          >
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Filtros adicionales */}
      <div className="mb-4 p-4 rounded-xl" style={{
        background: '#F3F4F6',
        border: '1px solid #E8EBED'
      }}>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Filtros</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Teléfono</label>
            <input
              type="text"
              placeholder="Buscar teléfono..."
              value={filters.phone}
              onChange={(e) => setFilters({...filters, phone: e.target.value})}
              className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none transition-all"
              style={{ borderColor: '#E8EBED' }}
              onFocus={(e) => {
                e.target.style.borderColor = '#5c19e3';
                e.target.style.boxShadow = '0 0 0 3px rgba(92, 25, 227, 0.08)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#E8EBED';
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Estado</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({...filters, status: e.target.value})}
              className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none transition-all"
              style={{ borderColor: '#E8EBED' }}
              onFocus={(e) => {
                e.target.style.borderColor = '#5c19e3';
                e.target.style.boxShadow = '0 0 0 3px rgba(92, 25, 227, 0.08)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#E8EBED';
                e.target.style.boxShadow = 'none';
              }}
            >
              <option value="all">Todos</option>
              <option value="ai">IA</option>
              <option value="human">Humano</option>
              <option value="support">Soporte</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Ventas</label>
            <select
              value={filters.hasSale}
              onChange={(e) => setFilters({...filters, hasSale: e.target.value})}
              className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none transition-all"
              style={{ borderColor: '#E8EBED' }}
              onFocus={(e) => {
                e.target.style.borderColor = '#5c19e3';
                e.target.style.boxShadow = '0 0 0 3px rgba(92, 25, 227, 0.08)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#E8EBED';
                e.target.style.boxShadow = 'none';
              }}
            >
              <option value="all">Todos</option>
              <option value="yes">Con venta</option>
              <option value="no">Sin venta</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Citas</label>
            <select
              value={filters.hasAppointment}
              onChange={(e) => setFilters({...filters, hasAppointment: e.target.value})}
              className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none transition-all"
              style={{ borderColor: '#E8EBED' }}
              onFocus={(e) => {
                e.target.style.borderColor = '#5c19e3';
                e.target.style.boxShadow = '0 0 0 3px rgba(92, 25, 227, 0.08)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#E8EBED';
                e.target.style.boxShadow = 'none';
              }}
            >
              <option value="all">Todos</option>
              <option value="yes">Con cita</option>
              <option value="no">Sin cita</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Tipo de Chat</label>
            <select
              value={filters.chatType}
              onChange={(e) => setFilters({...filters, chatType: e.target.value})}
              className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none transition-all"
              style={{ borderColor: '#E8EBED' }}
              onFocus={(e) => {
                e.target.style.borderColor = '#5c19e3';
                e.target.style.boxShadow = '0 0 0 3px rgba(92, 25, 227, 0.08)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#E8EBED';
                e.target.style.boxShadow = 'none';
              }}
            >
              <option value="all">Todos</option>
              <option value="individual">Individual</option>
              <option value="group">Grupo</option>
            </select>
          </div>
        </div>
        <div className="mt-2 text-xs text-gray-500">
          Mostrando {filteredReports.length} de {reports.length} conversaciones
        </div>
      </div>

      {analyzing && analyzeProgress.total > 0 && (
        <div className="mb-4 rounded-xl p-4" style={{
          background: 'rgba(92, 25, 227, 0.08)',
          border: '1px solid rgba(92, 25, 227, 0.2)'
        }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium" style={{ color: '#5c19e3' }}>
              Analizando conversaciones con IA...
            </span>
            <span className="text-sm font-semibold" style={{ color: '#5c19e3' }}>
              {Math.round((analyzeProgress.current / analyzeProgress.total) * 100)}%
            </span>
          </div>
          <div className="w-full rounded-full h-2" style={{ background: 'rgba(92, 25, 227, 0.2)' }}>
            <div
              className="h-2 rounded-full transition-all duration-300"
              style={{
                width: `${(analyzeProgress.current / analyzeProgress.total) * 100}%`,
                background: '#5c19e3'
              }}
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: '#5c19e3' }}></div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Fecha/Hora
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Teléfono
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Mensajes
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Estado
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Posible Venta
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Analizado con IA
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cita Agendada
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredReports.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-6 py-4 text-center text-gray-500">
                    No hay conversaciones para esta fecha
                  </td>
                </tr>
              ) : (
                filteredReports.map((report) => (
                  <tr key={report.id} className={`hover:bg-gray-50 transition-all ${report.isAnalyzing ? 'animate-pulse' : ''} ${analyzedIds.has(report.id) ? 'bg-green-50' : ''}`}
                    style={report.isAnalyzing ? { background: 'rgba(92, 25, 227, 0.05)' } : {}}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      <div className="flex items-center">
                        {report.isAnalyzing && (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 mr-2" style={{ borderColor: '#5c19e3' }}></div>
                        )}
                        {analyzedIds.has(report.id) && !report.isAnalyzing && (
                          <span className="text-green-500 mr-2" title="Analizado">✓</span>
                        )}
                        {report.id}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div>{report.fecha}</div>
                      <div className="text-xs">{report.hora}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <div className="flex items-center gap-2">
                        {report.isGroup ? (
                          <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20" title="Grupo">
                            <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"/>
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20" title="Individual">
                            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd"/>
                          </svg>
                        )}
                        <span>{formatPhone(report.telefono)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex items-center">
                        <span className="font-medium">{report.mensajes}</span>
                        <span className="ml-1 text-xs text-gray-400">msgs</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(report)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={report.posibleVenta}
                        onChange={(e) => handleSaleStatusChange(report, 'posibleVenta', e.target.checked)}
                        className="h-4 w-4 border-gray-300 rounded cursor-pointer"
                        style={{ accentColor: '#5c19e3' }}
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={report.ventaCerrada || report.analizadoIA || analyzedIds.has(report.id)}
                        disabled={true}
                        className="h-4 w-4 border-gray-300 rounded"
                        style={{ accentColor: '#5c19e3' }}
                        title="Se marca automáticamente al analizar con IA"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={report.citaAgendada || false}
                        onChange={(e) => handleSaleStatusChange(report, 'citaAgendada', e.target.checked)}
                        className="h-4 w-4 border-gray-300 rounded cursor-pointer"
                        style={{ accentColor: '#5c19e3' }}
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => {
                          // Crear objeto de contacto completo
                          const contact = {
                            phone: report.telefono,
                            messages: report.conversacion || [],
                            totalMessages: report.mensajes || 0,
                            userMessages: 0,
                            botMessages: 0,
                            firstContact: report.primerMensaje || new Date().toISOString(),
                            lastActivity: report.ultimoMensaje || new Date().toISOString(),
                            lastMessage: null,
                            isHumanMode: report.modoHumano || false,
                            mode: report.soporteActivado ? 'support' : (report.modoHumano ? 'human' : 'ai')
                          };
                          
                          // Contar mensajes por tipo
                          if (report.conversacion) {
                            report.conversacion.forEach(msg => {
                              if (msg.type === 'USER') contact.userMessages++;
                              if (msg.type === 'BOT' || msg.type === 'HUMAN') contact.botMessages++;
                            });
                            
                            // Obtener último mensaje
                            const lastMsg = report.conversacion[report.conversacion.length - 1];
                            if (lastMsg) {
                              contact.lastMessage = {
                                text: lastMsg.message,
                                time: lastMsg.timestamp,
                                type: lastMsg.type.toLowerCase()
                              };
                            }
                          }
                          
                          // Emitir evento con contacto completo
                          window.dispatchEvent(new CustomEvent('showChat', { detail: contact }));
                        }}
                        className="text-black hover:text-gray-600 font-medium"
                      >
                        Ver Chat
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Resumen estadístico */}
      {reports.length > 0 && (
        <div className="mt-6 pt-6 border-t" style={{ borderColor: '#E8EBED' }}>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="rounded-xl p-4" style={{
              background: '#F3F4F6',
              border: '1px solid #E8EBED'
            }}>
              <div className="text-sm text-gray-500">Total Conversaciones</div>
              <div className="text-2xl font-semibold text-gray-800">{reports.length}</div>
            </div>
            <div className="rounded-xl p-4" style={{
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.2)'
            }}>
              <div className="text-sm" style={{ color: '#3B82F6' }}>Posibles Ventas</div>
              <div className="text-2xl font-semibold text-gray-800">
                {reports.filter(r => r.posibleVenta).length}
              </div>
            </div>
            <div className="rounded-xl p-4" style={{
              background: 'rgba(92, 25, 227, 0.08)',
              border: '1px solid rgba(92, 25, 227, 0.2)'
            }}>
              <div className="text-sm" style={{ color: '#5c19e3' }}>Analizados con IA</div>
              <div className="text-2xl font-semibold text-gray-800">
                {reports.filter(r => r.ventaCerrada || r.analizadoIA || analyzedIds.has(r.id)).length}
              </div>
            </div>
            <div className="rounded-xl p-4" style={{
              background: 'rgba(34, 197, 94, 0.08)',
              border: '1px solid rgba(34, 197, 94, 0.2)'
            }}>
              <div className="text-sm" style={{ color: '#16A34A' }}>Citas Agendadas</div>
              <div className="text-2xl font-semibold text-gray-800">
                {reports.filter(r => r.citaAgendada).length}
              </div>
            </div>
            <div className="rounded-xl p-4" style={{
              background: 'rgba(249, 115, 22, 0.08)',
              border: '1px solid rgba(249, 115, 22, 0.2)'
            }}>
              <div className="text-sm" style={{ color: '#F97316' }}>Con Soporte</div>
              <div className="text-2xl font-semibold text-gray-800">
                {reports.filter(r => r.soporteActivado).length}
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

export default Reports;