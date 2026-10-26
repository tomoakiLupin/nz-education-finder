import { useCallback, useEffect, useState } from 'react';
import type { Dataset } from './types';
import { loadDataset } from './data';
import { filtersFromQuery, filtersToQuery, type Filters } from './filters';
import { SearchPage } from './components/SearchPage';
import { DetailPage } from './components/DetailPage';
import { AboutPage } from './components/AboutPage';
import { JobDetailPage } from './components/JobDetailPage';
import { JobsPage, jobFiltersFromQuery, jobFiltersToQuery, type JobFilters } from './components/JobsPage';
import { fmtDate } from './format';

// Hash routes: #/?<job filters>  ·  #/j/<gazette id>  ·  #/schools?<filters>  ·  #/i/<key>  ·  #/about
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
    if (route.path.startsWith('/i/') || route.path.startsWith('/j/')) window.scrollTo(0, 0);
  }, [route.path]);

  // Typing in a search box should not flood history.
  const navigate = useCallback((next: string, typing: boolean) => {
    if (typing) history.replaceState(null, '', next);
    else history.pushState(null, '', next);
    setRoute(parseHash());
  }, []);
  const filters = filtersFromQuery(route.qs);
  const setFilters = useCallback((f: Filters) => {
    const qs = filtersToQuery(f);
    navigate(`#/schools${qs ? `?${qs}` : ''}`, f.q !== filtersFromQuery(parseHash().qs).q);
  }, [navigate]);
  const jobFilters = jobFiltersFromQuery(route.qs);
  const setJobFilters = useCallback((f: JobFilters) => {
    const qs = jobFiltersToQuery(f);
    navigate(`#/${qs ? `?${qs}` : ''}`, f.q !== jobFiltersFromQuery(parseHash().qs).q);
  }, [navigate]);
  const open = useCallback((key: string) => { location.hash = `#/i/${encodeURIComponent(key)}`; }, []);

  let body: React.ReactNode;
  if (err) body = <div className="banner warn">数据加载失败：{err}。请稍后刷新重试。</div>;
  else if (!ds) body = <div className="loading">正在加载职位与机构数据…</div>;
  else if (route.path === '/about') body = <AboutPage ds={ds} />;
  else if (route.path.startsWith('/i/')) {
    const r = ds.byKey.get(decodeURIComponent(route.path.slice(3)));
    body = r ? <DetailPage ds={ds} r={r} /> : <div className="empty"><p>未找到该机构。</p><a className="btn" href="#/schools">返回目录</a></div>;
  } else if (route.path.startsWith('/j/')) {
    const j = ds.jobs.jobs.find((x) => String(x.id) === route.path.slice(3));
    body = j ? <JobDetailPage ds={ds} j={j} /> : <div className="empty"><p>该职位已截止或已下架。</p><a className="btn" href="#/">查看在招职位</a></div>;
  } else if (route.path === '/schools') body = <SearchPage ds={ds} f={filters} setF={setFilters} open={open} />;
  else body = <JobsPage ds={ds} f={jobFilters} setF={setJobFilters} />;

  return (
    <>
      <header className="site">
        <a href="#/" className="brand"><span className="logo" aria-hidden>⌂</span> NZ Education Finder</a>
        <nav>
          <a href="#/" className={route.path === '/' ? 'on' : ''}>在招职位</a>
          <a href="#/schools" className={route.path === '/schools' ? 'on' : ''}>机构目录</a>
          <a href="#/about" className={route.path === '/about' ? 'on' : ''}>数据与说明</a>
        </nav>
      </header>
      <main>{body}</main>
      <footer className="site">
        <span>职位：Education Gazette · 机构：Ministry of Education（data.govt.nz），CC BY 4.0 · AEWV：NZ Accredited Employer Inspector{ds && ` · 目录导入 ${fmtDate(ds.generatedAt, true)}`}</span>
        <span>地图 © OpenStreetMap contributors · 本站非政府网站，信息仅供参考</span>
      </footer>
    </>
  );
}
