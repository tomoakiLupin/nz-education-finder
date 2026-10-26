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
import { getLang, setLang, t, type Lang } from './i18n';

// Hash routes: #/?<job filters>  ·  #/archive?<job filters>  ·  #/j/<gazette id>  ·  #/schools?<filters>  ·  #/i/<key>  ·  #/about
function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = h.split('?');
  return { path, qs };
}

export function App() {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [route, setRoute] = useState(parseHash);
  const [lang, setLangState] = useState<Lang>(getLang);
  const switchLang = (l: Lang) => { setLang(l); setLangState(l); };

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
    const base = parseHash().path === '/archive' ? '#/archive' : '#/';
    navigate(`${base}${qs ? `?${qs}` : ''}`, f.q !== jobFiltersFromQuery(parseHash().qs).q);
  }, [navigate]);
  const open = useCallback((key: string) => { location.hash = `#/i/${encodeURIComponent(key)}`; }, []);

  let body: React.ReactNode;
  if (err) body = <div className="banner warn">{t(`数据加载失败：${err}。请稍后刷新重试。`, `Failed to load data: ${err}. Please refresh later.`)}</div>;
  else if (!ds) body = <div className="loading">{t('正在加载职位与机构数据…', 'Loading vacancies and institutions…')}</div>;
  else if (route.path === '/about') body = <AboutPage ds={ds} />;
  else if (route.path.startsWith('/i/')) {
    const r = ds.byKey.get(decodeURIComponent(route.path.slice(3)));
    body = r ? <DetailPage ds={ds} r={r} /> : <div className="empty"><p>{t('未找到该机构。', 'Institution not found.')}</p><a className="btn" href="#/schools">{t('返回目录', 'Back to directory')}</a></div>;
  } else if (route.path.startsWith('/j/')) {
    const id = route.path.slice(3);
    const j = ds.jobs.jobs.find((x) => String(x.id) === id) ?? ds.archive.find((x) => String(x.id) === id);
    body = j ? <JobDetailPage ds={ds} j={j} /> : <div className="empty"><p>{t('未找到该职位。', 'Vacancy not found.')}</p><a className="btn" href="#/">{t('查看在招职位', 'See open vacancies')}</a></div>;
  } else if (route.path === '/schools') body = <SearchPage ds={ds} f={filters} setF={setFilters} open={open} />;
  else if (route.path === '/archive') body = <JobsPage ds={ds} f={jobFilters} setF={setJobFilters} archive />;
  else body = <JobsPage ds={ds} f={jobFilters} setF={setJobFilters} />;

  return (
    <div key={lang} style={{ display: 'contents' }}>
      <header className="site">
        <a href="#/" className="brand"><span className="logo" aria-hidden>⌂</span> NZ Education Finder</a>
        <nav>
          <a href="#/" className={route.path === '/' || route.path === '/archive' ? 'on' : ''}>{t('职位', 'Vacancies')}</a>
          <a href="#/schools" className={route.path === '/schools' ? 'on' : ''}>{t('机构目录', 'Directory')}</a>
          <a href="#/about" className={route.path === '/about' ? 'on' : ''}>{t('数据与说明', 'About the data')}</a>
          <button className="lang" onClick={() => switchLang(lang === 'zh' ? 'en' : 'zh')} aria-label={t('切换到英文', 'Switch to Chinese')}>{lang === 'zh' ? 'EN' : '中文'}</button>
        </nav>
      </header>
      <main>{body}</main>
      <footer className="site">
        <span>{t('职位', 'Vacancies')}: Education Gazette · {t('机构', 'Institutions')}: Ministry of Education (data.govt.nz), CC BY 4.0 · AEWV: NZ Accredited Employer Inspector{ds && ` · ${t('目录导入', 'directory imported')} ${fmtDate(ds.generatedAt, true)}`}</span>
        <span>{t('地图', 'Map')} © OpenStreetMap contributors · {t('本站非政府网站，信息仅供参考', 'Not a government website; for reference only')}</span>
      </footer>
    </div>
  );
}
