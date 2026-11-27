import {useId, useState} from 'react';
import {useLanguage} from '../i18n.jsx';
import {number} from '../workflow.js';

const palette = ['#9aacb7', '#087c72', '#b87520'];
const format = value => Number.isFinite(value) ? value.toLocaleString(undefined, {maximumFractionDigits: 1}) : '—';

export function ChartCard({title, description, action, children, className = ''}) {
  return <section className={`panel report-card ${className}`}>
    <div className="report-card-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>
    {children}
  </section>;
}

export function EmptyState({title, description, action}) {
  return <div className="report-empty"><span aria-hidden="true">—</span><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}

export function BarChart({rows, series, label}) {
  const {t} = useLanguage();
  const max = Math.max(1, ...rows.flatMap(row => series.map(s => Number.isFinite(row[s.key]) ? row[s.key] : 0)));
  if (!rows.length) return <EmptyState title={t('No chart data')} />;
  return <div className="bar-chart" role="group" aria-label={label}>
    <div className="chart-legend">{series.map((s, i) => <span key={s.key}><i style={{background: s.color || palette[i]}} />{s.label}</span>)}</div>
    {rows.map(row => <div className="bar-chart-row" key={row.label}>
      <div className="bar-chart-label"><strong>{row.label}</strong>{row.note && <small>{row.note}</small>}</div>
      <div className="bar-chart-tracks">{series.map((s, i) => <div className="bar-chart-track" key={s.key}>
        <div className="bar-chart-rail"><div className="bar-chart-fill" style={{width: `${Number.isFinite(row[s.key]) ? row[s.key] / max * 100 : 0}%`, background: s.color || palette[i]}} /></div>
        <span>{format(row[s.key])}</span>
      </div>)}</div>
    </div>)}
  </div>;
}

// Null observations split the path. Never join across unobserved dates.
export function LineChart({points, label, unit}) {
  const {t} = useLanguage();
  const id = useId();
  const [selected, setSelected] = useState(null);
  const values = points.filter(p => Number.isFinite(p.value));
  if (!values.length) return <EmptyState title={t('No observations in this period')} description={t('Missing dates are left blank; they do not mean zero sales.')} />;
  const width = 680, height = 230, left = 54, right = 18, top = 20, bottom = 38;
  const max = Math.max(1, ...values.map(p => p.value)) * 1.12;
  const x = i => left + i / Math.max(1, points.length - 1) * (width - left - right);
  const y = value => height - bottom - value / max * (height - top - bottom);
  let started = false;
  const path = points.map((p, i) => {
    if (!Number.isFinite(p.value)) {started = false; return '';}
    const part = `${started ? 'L' : 'M'} ${x(i)} ${y(p.value)}`; started = true; return part;
  }).join(' ');
  const active = selected == null ? values.at(-1) : points[selected];
  return <div className="line-chart">
    {values.length < points.length && <p className="chart-coverage">{t('Complete dates')}: <strong>{values.length} / {points.length}</strong> · {t('Missing history is not interpolated.')}</p>}
    <div className="chart-readout" aria-live="polite"><span>{active?.date}</span><strong>{format(active?.value)} <small>{unit}</small></strong>{active?.stockout && <span className="signal-tag signal-warn">{t('Zero stock')}</span>}</div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={id}>
      <title id={id}>{label}</title>
      {[0, 1, 2, 3].map(i => <g key={i}><line x1={left} y1={y(max * i / 3)} x2={width-right} y2={y(max * i / 3)} stroke="#e4e9eb" strokeDasharray="3 5" /><text x={left-10} y={y(max*i/3)+4} textAnchor="end">{Math.round(max*i/3).toLocaleString()}</text></g>)}
      <path d={path} fill="none" stroke="#087c72" strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((p, i) => Number.isFinite(p.value) && <g key={p.date}>
        <circle cx={x(i)} cy={y(p.value)} r={p.stockout ? 4 : 3} fill={p.stockout ? '#b87520' : '#087c72'} />
        <circle className="chart-point" cx={x(i)} cy={y(p.value)} r="9" fill="transparent" tabIndex="0" role="img" aria-label={`${p.date}: ${format(p.value)} ${unit}${p.stockout ? ` · ${t('Zero stock')}` : ''}`} onMouseEnter={() => setSelected(i)} onFocus={() => setSelected(i)}><title>{p.date}: {format(p.value)} {unit}</title></circle>
      </g>)}
      {[...new Set([0, Math.floor((points.length-1)/2), points.length-1])].map(i => <text key={i} x={x(i)} y={height-10} textAnchor={i === 0 ? 'start' : i === points.length-1 ? 'end' : 'middle'}>{points[i]?.date}</text>)}
    </svg>
    <p className="chart-footnote">{t('Missing dates are left blank; they do not mean zero sales.')}</p>
    <details className="chart-data"><summary>{t('View chart data')}</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>{t('Data date')}</th><th>{unit}</th></tr></thead><tbody>{points.map(p => <tr key={p.date}><td>{p.date}</td><td>{format(p.value)}</td></tr>)}</tbody></table></div></details>
  </div>;
}

export function DonutChart({segments, label}) {
  const {t} = useLanguage();
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  let offset = 0;
  return total ? <div className="donut-chart">
    <div className="donut-graphic"><svg viewBox="0 0 160 160" role="img" aria-label={label}>
      <circle cx="80" cy="80" r="60" fill="none" stroke="#edf1f3" strokeWidth="18" />
      {segments.map((s, i) => {const length = s.value / total * 100, start = offset; offset += length;
        return <circle key={s.label} cx="80" cy="80" r="60" fill="none" stroke={s.color || palette[i]} strokeWidth="18" pathLength="100" strokeDasharray={`${length} ${100-length}`} strokeDashoffset={-start} transform="rotate(-90 80 80)"><title>{s.label}: {s.value}</title></circle>;
      })}</svg><div><strong>{number(total)}</strong><span>{t('Products')}</span></div></div>
    <div className="donut-legend">{segments.map((s, i) => <div key={s.label}><span><i style={{background: s.color || palette[i]}} />{s.label}</span><strong>{number(s.value)}</strong></div>)}</div>
  </div> : <EmptyState title={t('No chart data')} />;
}
