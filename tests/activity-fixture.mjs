import {mkdir,writeFile,rm} from 'node:fs/promises';
if(process.env.CI!=='true'||process.env.NETLIFY==='true')throw new Error('Activity fixture is restricted to isolated GitHub CI.');
if(process.argv.includes('--clean')){await rm('app/activity-ui-fixture',{recursive:true,force:true});}
else{
 await mkdir('app/activity-ui-fixture',{recursive:true});
 await writeFile('app/activity-ui-fixture/page.tsx',`import Dashboard from '../admin/activity/ActivityDashboard';\nimport '../admin/activity/activity.css';\nexport default function Fixture(){return <Dashboard/>;}\n`);
}
