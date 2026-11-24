import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Star, TrendingUp, Wallet, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api.js';
import { useAmpwise } from '../App.jsx';

const rs = value => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function HistoryPage() {
  const { user, notify } = useAmpwise();
  const { t } = useTranslation();
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [rating, setRating] = useState({ booking_id: '', stars: 5, comment: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => api(`/analytics/operator/${user.id}`).then(data => live && setReport(data)).catch(err => live && setError(err.message));
    load(); const timer = setInterval(load, 3000);
    return () => { live = false; clearInterval(timer); };
  }, [user.id]);
  const sessions = report?.sessions || [];
  const unrated = sessions.filter(row => row.status === 'completed' && !row.has_rating);
  const totalEnergy = sessions.reduce((sum, row) => sum + row.energy_delivered_kwh, 0);
  const totalCost = sessions.reduce((sum, row) => sum + (row.final_bill || 0), 0);

  const sendRating = async event => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await api('/ratings', { method: 'POST', body: JSON.stringify({ ...rating, booking_id: Number(rating.booking_id), operator_id: user.id, stars: Number(rating.stars) }) });
      notify(t('ratingSaved')); setRating({ booking_id: '', stars: 5, comment: '' });
      const refreshed = await api(`/analytics/operator/${user.id}`); setReport(refreshed);
    } catch (actionError) { setError(actionError.message); }
    finally { setSaving(false); }
  };

  return <div className="page-stack">
    <section className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-bullet" /> {t('fleetPerformance')}</div><h1>{t('history')}</h1><p>{t('analyticsIntro')}</p></div><span className="poll-pill"><i /> {t('updatedLive')}</span></section>
    {error && <div className="form-error">{error}</div>}
    <div className="metrics-grid analytics-metrics"><div className="metric-card"><div className="metric-head"><span>{t('energyDelivered')}</span><i className="metric-icon mint"><Zap size={17} /></i></div><div className="metric-value">{totalEnergy.toFixed(1)}<small>kWh</small></div><div className="metric-foot">{t('settledCount', { count: sessions.length })}</div></div><div className="metric-card"><div className="metric-head"><span>{t('finalChargingCost')}</span><i className="metric-icon blue"><Wallet size={17} /></i></div><div className="metric-value">{rs(totalCost)}</div><div className="metric-foot">{t('afterCancellation')}</div></div><div className="metric-card"><div className="metric-head"><span>{t('ratedStations')}</span><i className="metric-icon amber"><Star size={17} /></i></div><div className="metric-value">{report?.station_ratings?.filter(row => row.average_stars).length || 0}<small>{t('locations')}</small></div><div className="metric-foot">{t('stationRatings')}</div></div><div className="metric-card"><div className="metric-head"><span>{t('networkTrend')}</span><i className="metric-icon violet"><TrendingUp size={17} /></i></div><div className="metric-value">{report?.daily?.length || 0}<small>{t('days')}</small></div><div className="metric-foot">{t('energyCostTrend')}</div></div></div>
    <div className="analytics-chart-grid"><section className="panel-card chart-panel"><div className="panel-titlebar"><div><b>{t('energyCostTime')}</b><small>{t('completedCancelled')}</small></div><span className="chart-legend"><i />{t('energyKwh')} <i className="legend-blue" />{t('costRs')}</span></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={report?.daily || []} margin={{ top: 10, right: 16, bottom: 3, left: -12 }}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#edf1f5" /><XAxis dataKey="date" tick={{ fill: '#8490a1', fontSize: 9 }} axisLine={false} tickLine={false} /><YAxis yAxisId="left" tick={{ fill: '#9aa4b2', fontSize: 9 }} axisLine={false} tickLine={false} /><YAxis yAxisId="right" orientation="right" tick={{ fill: '#9aa4b2', fontSize: 9 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ border: '1px solid #edf0f4', borderRadius: 10, fontSize: 12 }} /><Line yAxisId="left" type="monotone" dataKey="energy_kwh" name={t('energyKwh')} stroke="#43c39b" strokeWidth={2.6} dot={{ r: 4, fill: '#43c39b' }} /><Line yAxisId="right" type="monotone" dataKey="cost_rs" name={t('costRs')} stroke="#6a86e8" strokeWidth={2.3} dot={{ r: 3, fill: '#6a86e8' }} /></LineChart></ResponsiveContainer></div></section>
      <section className="panel-card chart-panel"><div className="panel-titlebar"><div><b>{t('peakPower')}</b><small>{t('highestDaily')}</small></div></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={report?.daily || []} margin={{ top: 14, right: 8, bottom: 3, left: -14 }}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#edf1f5" /><XAxis dataKey="date" tick={{ fill: '#8490a1', fontSize: 9 }} axisLine={false} tickLine={false} /><YAxis unit=" kW" tick={{ fill: '#9aa4b2', fontSize: 9 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ border: '1px solid #edf0f4', borderRadius: 10, fontSize: 12 }} /><Bar dataKey="power_kw" name={t('peakPower')} fill="#48c8a2" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></section></div>
    <section className="panel-card history-table"><div className="panel-titlebar"><div><b>{t('sessionHistory')}</b><small>{t('actualSettlement')}</small></div></div><div className="history-table-head"><span>{t('vehicleStation')}</span><span>{t('finished')}</span><span>{t('energy')}</span><span>{t('finalBill')}</span><span>{t('refund')}</span></div>{sessions.length ? sessions.slice(0, 12).map(row => <div className="history-table-row" key={row.id}><div><b>{row.reg}</b><small>{row.station_name}</small></div><span>{row.completed_at ? new Date(row.completed_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</span><b>{row.energy_delivered_kwh.toFixed(1)} kWh</b><b>{rs(row.final_bill)}</b><span className="refund-positive">{rs(row.refund)}</span></div>) : <div className="empty-inline">{t('noCompletedSessions')}</div>}</section>
    <section className="feedback-layout"><div className="panel-card feedback-intro"><div className="feedback-star"><Star size={20} /></div><div><b>{t('rateNetwork')}</b><p>{t('shareStationRating')}</p></div></div><form className="panel-card rating-form" onSubmit={sendRating}><div className="panel-titlebar"><div><b>{t('stationFeedback')}</b><small>{t('onlyFinishedRate')}</small></div></div><div className="rating-form-fields"><label className="form-field"><span className="field-label">{t('completedSession')}</span><select className="select-input" value={rating.booking_id} onChange={event => setRating(current => ({ ...current, booking_id: event.target.value }))} required><option value="">{t('selectSession')}</option>{unrated.map(row => <option key={row.id} value={row.id}>#{row.id} · {row.reg} · {row.station_name}</option>)}</select></label><label className="form-field"><span className="field-label">{t('stationRating')}</span><select className="select-input" value={rating.stars} onChange={event => setRating(current => ({ ...current, stars: event.target.value }))}>{[5,4,3,2,1].map(value => <option key={value} value={value}>{'★'.repeat(value)} · {value}/5</option>)}</select></label><label className="form-field span-two"><span className="field-label">{t('optionalComment')}</span><textarea className="text-area" value={rating.comment} onChange={event => setRating(current => ({ ...current, comment: event.target.value }))} placeholder={t('whatWorked')} /></label></div><button className="button-primary" disabled={saving || !unrated.length}>{saving ? t('saving') : t('submitRating')}</button></form></section>
  </div>;
}
