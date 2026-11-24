import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, Bell, BusFront, Cable, ChartNoAxesCombined, ChevronDown, CircleHelp, Clock3, Gauge, LayoutDashboard, MapPin, Menu, PlugZap, Settings2, ShieldAlert, X } from 'lucide-react';
import { api } from './api';
import Dashboard from './pages/Dashboard.jsx';
import BookingPage from './pages/Booking.jsx';
import ChargingPage from './pages/Charging.jsx';
import QueuePage from './pages/Queue.jsx';
import HistoryPage from './pages/History.jsx';
import AdminPage from './pages/Admin.jsx';

const AmpwiseContext = createContext(null);
export const useAmpwise = () => useContext(AmpwiseContext);

const navigation = [
  { to: '/', key: 'overview', icon: LayoutDashboard, end: true },
  { to: '/book', key: 'book', icon: PlugZap },
  { to: '/charging', key: 'charging', icon: Activity },
  { to: '/queue', key: 'queue', icon: Cable },
  { to: '/history', key: 'history', icon: ChartNoAxesCombined },
  { to: '/admin', key: 'admin', icon: Settings2 },
];

function initials(name = '') { return name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(); }
function readRemindedIds() { try { return JSON.parse(localStorage.getItem('ampwise-reminded') || '[]'); } catch { return []; } }
function utcTimestamp(value) { return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).getTime(); }

function AppShell({ user, onRoleChange, stations, alerts, activeCount, notifications, onEnableAlerts, children }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const activeFaults = stations.filter(station => station.is_faulty && alerts.some(alert => alert.station_id === station.id));
  return <div className="app-layout">
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-symbol"><PlugZap size={21} /></div><div><b>AMPWISE</b><small>FLEET POWER, IN BALANCE</small></div><button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label={t('closeMenu')}><X size={18} /></button></div>
      <div className="org-chip"><div className="org-icon">TN</div><div><b>TN Transit Network</b><small>{t('workspace')}</small></div><ChevronDown size={14} /></div>
      <div className="side-label">{t('operations')}</div>
      <nav className="nav-links">
        {navigation.map(({ to, key, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'selected' : ''}`}>
          <Icon size={17} strokeWidth={1.8} /><span>{t(key)}</span>{key === 'charging' && <small className="nav-count">{activeCount}</small>}
        </NavLink>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="side-help"><CircleHelp size={17} /><div><b>{t('dispatcherGuide')}</b><small>{t('scoringBasics')}</small></div><span>↗</span></div>
        <div className="side-user"><div className="avatar">{initials(user.name)}</div><div><b>{user.name}</b><small>{user.role === 'admin' ? 'Network admin' : 'Bus operator'}</small></div><span className="user-dot" /></div>
      </div>
    </aside>

    <section className="app-main">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label={t('openMenu')}><Menu size={20} /></button>
        <div className="breadcrumb"><span>AMPWISE</span><span className="slash">/</span><b>{navigation.find(item => item.to === location.pathname)?.key ? t(navigation.find(item => item.to === location.pathname).key) : t('overview')}</b></div>
        <div className="topbar-actions">
          <span className="connected"><i /> API <b>{t('apiConnected')}</b></span>
          <label className="role-picker"><span>{t('role')}</span><select value={user.role} onChange={event => onRoleChange(event.target.value)} aria-label={t('switchDemoRole')}><option value="operator">{t('operator')}</option><option value="admin">{t('adminRole')}</option></select><ChevronDown size={12} /></label>
          <label className="language-picker"><span>文</span><select value={i18n.language} onChange={event => { i18n.changeLanguage(event.target.value); localStorage.setItem('ampwise-language', event.target.value); }} aria-label={t('language')}><option value="en">EN</option><option value="hi">हिंदी</option><option value="ta">தமிழ்</option><option value="te">తెలుగు</option></select></label>
          <div className="bell-wrap"><button className={`bell-button ${bellOpen ? 'on' : ''}`} onClick={() => setBellOpen(value => !value)} aria-label={t('notifications')}><Bell size={17} /><i /></button>
            {bellOpen && <div className="notification-popover"><div className="popover-title"><b>{t('notifications')}</b><button type="button" onClick={onEnableAlerts}>{typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted' ? t('browserAlertsOn') : t('enableBrowserAlerts')}</button></div>
              {notifications.length ? notifications.slice(0, 6).map(item => { const Icon = item.type === 'emergency' ? ShieldAlert : item.type === 'power' ? Zap : Bell; return <div className="notification-row" key={item.id}><div className="notice-icon"><Icon size={15} /></div><div><b>{item.titleKey ? t(item.titleKey) : item.title}</b><p>{item.body}</p><small>{item.time}</small></div></div>; }) : <div className="notification-foot">{t('emptyNotifications')}</div>}
              <div className="notification-foot">{t('inAppAlerts')}</div></div>}
          </div>
          <div className="top-avatar">{initials(user.name)}</div>
        </div>
      </header>
      {activeFaults.length > 0 && <div className="fault-strip"><ShieldAlert size={16} /><span><b>{t('stationAlert')}:</b> {activeFaults.map(station => `${station.name} · ${station.fault_message}`).join('  |  ')}</span><span className="demo-tag">LIVE</span></div>}
      <main className="page-content">{children}</main>
      <footer className="app-footer"><span><i /> {t('simulated')}</span><span>AMPWISE · Tamil Nadu fleet charging</span></footer>
    </section>
  </div>;
}

export default function App() {
  const { t } = useTranslation();
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ampwise-user') || 'null'); } catch { return null; }
  });
  const [stations, setStations] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [toasts, setToasts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const lastBookingsRef = useRef(null);
  const lastStationsRef = useRef(null);
  const lastAlertsRef = useRef(null);
  const remindedRef = useRef(new Set(readRemindedIds()));

  const notify = useCallback((message, type = 'success', title = 'AMPWISE update') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(current => [...current, { id, message, type }]);
    const titleKey = { power: 'powerUpdated', reminder: 'upcomingAppointment', emergency: 'emergencyReserveActive', warning: 'stationAlert' }[type];
    const displayTitle = titleKey ? t(titleKey) : title;
    setNotifications(current => [{ id, title: displayTitle, titleKey, body: message, type, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }, ...current].slice(0, 20));
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification(displayTitle, { body: message, icon: '/ampwise.svg', tag: `ampwise-${id}` }); } catch { /* Toasts remain available if desktop notifications are blocked. */ }
    setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), 4600);
  }, [t]);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const [stationRows, bookingRows, alertRows] = await Promise.all([
        api('/stations'), api(`/bookings?operator_id=${user.id}`), api(`/alerts?operator_id=${user.id}`),
      ]);
      const previousBookings = lastBookingsRef.current;
      if (previousBookings) {
        const previousById = new Map(previousBookings.map(booking => [booking.id, booking]));
        bookingRows.filter(booking => ['queued', 'charging'].includes(booking.status)).forEach(booking => {
          const previous = previousById.get(booking.id);
          if (previous && Math.abs(Number(previous.allocated_kw) - Number(booking.allocated_kw)) >= 1) {
            notify(t('powerChangedMessage', { reg: booking.reg, from: Math.round(previous.allocated_kw), to: Math.round(booking.allocated_kw) }), 'power', 'Power allocation updated');
          }
        });
      }
      lastBookingsRef.current = bookingRows;

      const previousStations = lastStationsRef.current;
      if (previousStations) {
        const previousById = new Map(previousStations.map(station => [station.id, station]));
        stationRows.filter(station => station.reserve_used_kw > 0).forEach(station => {
          if ((previousById.get(station.id)?.reserve_used_kw || 0) <= 0) notify(t('reserveActivatedMessage', { station: station.name }), 'emergency', 'Emergency reserve active');
        });
      }
      lastStationsRef.current = stationRows;

      const previousAlerts = lastAlertsRef.current || [];
      const knownAlertIds = new Set(previousAlerts.map(alert => alert.id));
      alertRows.filter(alert => !knownAlertIds.has(alert.id)).forEach(alert => notify(t('stationAlertMessage', { station: alert.station_name, message: alert.message }), 'warning', 'Station alert'));
      lastAlertsRef.current = alertRows;

      const now = Date.now();
      bookingRows.filter(booking => ['queued', 'charging'].includes(booking.status) && booking.preferred_arrival).forEach(booking => {
        const minutes = (utcTimestamp(booking.preferred_arrival) - now) / 60_000;
        if (minutes >= 0 && minutes <= 15 && !remindedRef.current.has(booking.id)) {
          remindedRef.current.add(booking.id);
          localStorage.setItem('ampwise-reminded', JSON.stringify([...remindedRef.current]));
          notify(t('appointmentReminderMessage', { reg: booking.reg, station: booking.station_name }), 'reminder', 'Upcoming charging appointment');
        }
      });
      setStations(stationRows); setBookings(bookingRows); setAlerts(alertRows); setApiError('');
    } catch (error) { setApiError(error.message); }
    finally { setLoading(false); }
  }, [user, notify]);

  useEffect(() => {
    let cancelled = false;
    if (!user) api('/auth/login', { method: 'POST', body: JSON.stringify({ role: 'operator' }) })
      .then(result => { if (!cancelled) { localStorage.setItem('ampwise-user', JSON.stringify(result)); setUser(result); } })
      .catch(error => { if (!cancelled) { setApiError(error.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    refresh();
    const timer = setInterval(refresh, 3000); // REST polling is the live update mechanism for this prototype.
    return () => clearInterval(timer);
  }, [user, refresh]);

  const changeRole = async role => {
    try {
      const next = await api('/auth/login', { method: 'POST', body: JSON.stringify({ role }) });
      localStorage.setItem('ampwise-user', JSON.stringify(next)); setUser(next); notify(t('roleSwitched', { role: t(role === 'admin' ? 'adminRole' : 'operator') }));
    } catch (error) { notify(error.message, 'error'); }
  };

  const enableBrowserAlerts = async () => {
    if (!('Notification' in window)) { notify(t('desktopAlertsUnsupported'), 'warning'); return; }
    const permission = await Notification.requestPermission();
    notify(permission === 'granted' ? t('desktopAlertsEnabled') : t('browserPermissionNotGranted'), permission === 'granted' ? 'success' : 'warning', t('browserAlertsTitle'));
  };

  const context = useMemo(() => ({ user, stations, bookings, alerts, loading, apiError, api, refresh, notify }), [user, stations, bookings, alerts, loading, apiError, refresh, notify]);
  if (!user && loading) return <div className="boot-screen"><div className="brand-symbol"><PlugZap /></div><b>AMPWISE</b><span>Loading fleet network…</span></div>;
  if (!user && apiError) return <div className="boot-screen error-screen"><div className="brand-symbol"><PlugZap /></div><b>AMPWISE can’t reach the API</b><p>{apiError}</p><code>Start the backend at http://localhost:9000</code></div>;

  const activeCount = bookings.filter(booking => ['charging', 'queued'].includes(booking.status)).length;
  return <AmpwiseContext.Provider value={context}>
    <AppShell user={user} onRoleChange={changeRole} stations={stations} alerts={alerts} activeCount={activeCount} notifications={notifications} onEnableAlerts={enableBrowserAlerts}>
      {apiError && <div className="inline-error"><ShieldAlert size={16} /> API connection issue: {apiError} <button onClick={refresh}>{t('retry')}</button></div>}
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/book" element={<BookingPage />} />
        <Route path="/charging" element={<ChargingPage />} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
    <div className="toast-stack" aria-live="polite">{toasts.map(toast => <div key={toast.id} className={`toast ${toast.type}`}><i />{toast.message}</div>)}</div>
  </AmpwiseContext.Provider>;
}
