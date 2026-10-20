import type { MetadataRoute } from 'next';
const guideRoutes = ['/how-to-play', '/rules', '/scoring', '/help', '/tutorial', '/progress-help', '/install', '/about-help'];
const routes = ['', ...guideRoutes, '/privacy', '/terms', '/cookies', '/data-account'];
export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map(path => ({ url: `https://parkesrummy.com${path}`, lastModified: new Date(), changeFrequency: path ? 'monthly' : 'weekly', priority: path ? guideRoutes.includes(path) ? 0.8 : 0.4 : 1 }));
}
