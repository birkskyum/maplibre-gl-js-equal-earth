import {cp, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = fileURLToPath(new URL('.', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'equal-earth-pages-'));

try {
    for (const name of ['index.html', 'LICENSE.txt', 'build-info.json', 'dist']) {
        await cp(join(root, name), join(output, name), {recursive: true});
    }
    execFileSync('npx', ['--yes', 'wrangler@4.129.1', 'pages', 'deploy', output,
        '--project-name', 'maplibre-gl-js-equal-earth', '--branch', 'main'],
    {cwd: root, stdio: 'inherit'});
} finally {
    await rm(output, {recursive: true, force: true});
}
