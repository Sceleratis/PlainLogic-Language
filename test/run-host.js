'use strict';

// Launch an installed VS Code with an isolated profile; never install or update extensions.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const root = path.resolve(__dirname, '..');
const runId = `${Date.now()}-${process.pid}`;
const runDirectory = path.join(root, '.vscode-test', `run-${runId}`);
const reportPath = path.join(runDirectory, 'report.json');

function locateCode() {
    if (process.env.VSCODE_EXECUTABLE) {
        const explicit = path.resolve(process.env.VSCODE_EXECUTABLE);
        if (!fs.existsSync(explicit)) throw new Error(`VSCODE_EXECUTABLE does not exist: ${explicit}`);
        return explicit;
    }
    const candidates = process.platform === 'win32' ? [
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
        path.join(process.env.ProgramFiles || '', 'Microsoft VS Code', 'Code.exe'),
    ] : process.platform === 'darwin' ? [
        '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
        path.join(os.homedir(), 'Applications', 'Visual Studio Code.app', 'Contents', 'MacOS', 'Electron'),
    ] : ['/usr/share/code/code', '/opt/visual-studio-code/code', '/usr/bin/code'];
    const found = candidates.find(candidate => fs.existsSync(candidate));
    if (!found) throw new Error('An installed VS Code was not found. Set VSCODE_EXECUTABLE to its executable path. No download is performed.');
    return found;
}

function powershellLiteral(value) {
    return "'" + value.replace(/'/g, "''") + "'";
}

// Start-Process joins ArgumentList into a Windows command line. Quote each argv value
// using the Windows escaping rules before passing that complete string as a PS literal.
function windowsArgument(value) {
    return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

async function main() {
    const code = locateCode();
    const userData = path.join(runDirectory, 'user-data');
    const extensions = path.join(runDirectory, 'extensions');
    const logs = path.join(runDirectory, 'logs');
    for (const directory of [path.join(userData, 'User'), extensions, logs]) fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({
        'telemetry.telemetryLevel': 'off',
        'update.mode': 'none',
        'extensions.autoUpdate': false,
        'extensions.autoCheckUpdates': false,
        'workbench.startupEditor': 'none',
        'workbench.enableExperiments': false,
        'window.restoreWindows': 'none',
        'files.hotExit': 'off',
        'security.workspace.trust.enabled': false
    }, null, 2));
    const args = [
        '--new-window', '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
        '--disable-updates', '--disable-gpu',
        `--user-data-dir=${userData}`, `--extensions-dir=${extensions}`, `--logsPath=${logs}`,
        `--extensionDevelopmentPath=${root}`, `--extensionTestsPath=${path.join(__dirname, 'host.js')}`, root
    ];
    const env = { ...process.env, PLAINLOGIC_TEST_REPORT: reportPath, PLAINLOGIC_TEST_RUN_ID: runId };
    // These can redirect a nested launch to the calling editor or turn Electron into Node.
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VSCODE_IPC_HOOK_CLI;
    let executable = code;
    let launchArgs = args;
    if (process.platform === 'win32') {
        const script = [
            "$ErrorActionPreference = 'Stop'",
            `$taskProcess = Start-Process -FilePath ${powershellLiteral(code)} -ArgumentList ${powershellLiteral(args.map(windowsArgument).join(' '))} -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput ${powershellLiteral(path.join(runDirectory, 'stdout.log'))} -RedirectStandardError ${powershellLiteral(path.join(runDirectory, 'stderr.log'))}`,
            'exit $taskProcess.ExitCode'
        ].join('\n');
        executable = 'powershell.exe';
        launchArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script];
    }
    console.log(`Running installed VS Code integration tests with isolated profile: ${runDirectory}`);
    const child = childProcess.spawn(executable, launchArgs, { env, windowsHide: true, stdio: 'inherit' });
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        console.error('VS Code integration launch exceeded 150 seconds; stopping only this test process tree.');
        if (process.platform === 'win32') childProcess.spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else child.kill('SIGTERM');
    }, 150000);
    let exitCode;
    try {
        exitCode = await new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', resolve);
        });
    } finally {
        clearTimeout(timeout);
    }
    if (timedOut) throw new Error(`Integration test launch timed out. Logs: ${logs}`);
    if (!fs.existsSync(reportPath)) throw new Error(`VS Code exited ${exitCode} without executing the integration suite. Logs: ${logs}`);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (report.runId !== runId || report.completed !== true || report.tests?.length < 10) {
        throw new Error(`The VS Code integration report is incomplete or belongs to another launch: ${reportPath}`);
    }
    for (const result of report.tests) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.passed ? '' : '\n' + result.error}`);
    console.log(`VS Code ${report.vscode}: ${report.passed}/${report.tests.length} integration checks passed. Report: ${reportPath}`);
    if (exitCode !== 0 || report.failed !== 0) throw new Error(`VS Code integration failed (exit ${exitCode}, ${report.failed} failed checks).`);
}

main().catch(error => {
    console.error(error.stack || String(error));
    process.exitCode = 1;
});
