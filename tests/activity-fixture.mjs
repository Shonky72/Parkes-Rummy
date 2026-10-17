import {mkdir,writeFile} from 'node:fs/promises';
if(process.env.CI!=='true'||process.env.NETLIFY==='true')throw new Error('Activity fixture is restricted to isolated GitHub CI.');
await mkdir('app/__activity_ui_fixture',{recursive:true});
await writeFile('app/__activity_ui_fixture/page.tsx',`import Dashboard from '../admin/activity/ActivityDashboard';\nimport '../admin/activity/activity.css';\nexport default function Fixture(){return <Dashboard/>;}\n`);
