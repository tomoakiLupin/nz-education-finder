import { useCallback, useEffect, useState } from 'react';
import type { Dataset } from './types';
import { loadDataset } from './data';
import { filtersFromQuery, filtersToQuery, type Filters } from './filters';
import { SearchPage } from './components/SearchPage';
import { DetailPage } from './components/DetailPage';
import { AboutPage } from './components/AboutPage';
import { fmtDate } from './format';

// Hash routes: #/?<filters>  ·  #/i/<key>  ·  #/about
function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = h.split('?');
  return { path, qs };
}

export function App() {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    loadDataset().then(setDs, (e) => setErr(String(e.message ?? e)));
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    if (route.path.startsWith('/i/')) window.scrollTo(0, 0);
  }, [route.path]);

  const filters = filtersFromQuery(route.qs);
  const setFilters = useCallback((f: Filters) => {
    const qs = filtersToQuery(f);
    const next = `#/${qs ? `?${qs}` : ''}`;
    // Typing in the search box should not flood history.
    if (f.q !== filtersFromQuery(parseHash().qs).q) history.replaceState(null, '', next);
    else history.pushState(null, '', next);
    setRoute(parseHash());
  }, []);
  const open = useCallback((key: string) => { location.hash = `#/i/${encodeURIComponent(key)}`; }, []);

  let body: React.ReactNode;
  if (err) body = <div className="banner warn">数据加载失败：{err}。请稍后刷新重试。</div>;
  else if (!ds) body = <div className="loading">正在加载机构目录…</div>;
  else if (route.path === '/about') body = <AboutPage ds={ds} />;
  else if (route.path.startsWith('/i/')) {
    const r = ds.byKey.get(decodeURIComponent(route.path.slice(3)));
    body = r ? <DetailPage ds={ds} r={r} /> : <div className="empty"><p>未找到该机构。</p><a className="btn" href="#/">返回目录</a></div>;
  } else body = <SearchPage ds={ds} f={filters} setF={setFilters} open={open} />;

  return (
    <>
      <header className="site">
        <a href="#/" className="brand"><span className="logo" aria-hidden>⌂</span> NZ Education Finder</a>
        <nav>
          <a href="#/" className={route.path === '/' ? 'on' : ''}>机构目录</a>
          <a href="#/about" className={route.path === '/about' ? 'on' : ''}>数据与说明</a>
        </nav>
      </header>
      <main>{body}</main>
      <footer className="site">
        <span>数据：Ministry of Education（Education Counts／data.govt.nz），CC BY 4.0{ds && ` · 本站导入 ${fmtDate(ds.generatedAt, true)}`}</span>
        <span>地图 © OpenStreetMap contributors · 本站非政府网站，信息仅供参考</span>
      </footer>
    </>
  );
}
