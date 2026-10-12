import type { MetadataRoute } from 'next';
const routes = ['', '/privacy', '/terms', '/cookies', '/data-account', '/store', '/about-help'];
export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map(path => ({ url: `https://parkesrummy.com${path}`, lastModified: new Date(), changeFrequency: path ? 'monthly' : 'weekly', priority: path ? 0.5 : 1 }));
}
