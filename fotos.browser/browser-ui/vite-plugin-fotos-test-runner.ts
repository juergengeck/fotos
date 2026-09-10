import {spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Plugin, ViteDevServer} from 'vite';

type RunnerProfile = 'ui' | 'full';
type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'stopped';

interface RunnerStep {
    id: string;
    title: string;
    status: StepStatus;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    summary: string | null;
}

interface RunnerState {
    runId: string | null;
    profile: RunnerProfile | null;
    status: 'idle' | 'running' | 'passed' | 'failed' | 'stopped';
    startedAt: string | null;
    finishedAt: string | null;
    reportPath: string | null;
    currentStepId: string | null;
    coverage: {
        documented: number;
        mapped: number;
        missing: string[];
        stale: string[];
    };
    steps: RunnerStep[];
    logs: string[];
    error: string | null;
}

interface StepDefinition {
    id: string;
    title: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    run?: () => Promise<{summary: string; details?: Record<string, unknown>}>;
}

const MAX_LOG_LINES = 2_000;

function emptyState(): RunnerState {
    return {
        runId: null,
        profile: null,
        status: 'idle',
        startedAt: null,
        finishedAt: null,
        reportPath: null,
        currentStepId: null,
        coverage: {documented: 0, mapped: 0, missing: [], stale: []},
        steps: [],
        logs: [],
        error: null,
    };
}

function json(res: any, statusCode: number, value: unknown): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(value, null, 2));
}

async function readJsonBody(req: any): Promise<Record<string, unknown>> {
    let source = '';
    for await (const chunk of req) source += chunk.toString();
    if (!source.trim()) return {};
    return JSON.parse(source) as Record<string, unknown>;
}

export function fotosTestRunnerPlugin(browserUiRoot: string): Plugin {
    const repoRoot = path.resolve(browserUiRoot, '../..');
    const reportsDir = path.resolve(browserUiRoot, 'tests/integration/reports');
    const coverageModule = path.resolve(browserUiRoot, 'tests/integration/fotos-flow-coverage.mjs');
    const prdPath = path.resolve(repoRoot, 'docs/product/ui.prd.md');
    const qaCoreModule = path.resolve(repoRoot, '../one/packages/qa.core/dist/index.js');
    let state = emptyState();
    let activeChild: ChildProcess | null = null;
    let stopRequested = false;
    let reportLogs: string[] = [];
    const listeners = new Set<any>();

    function publish(): void {
        const payload = `data: ${JSON.stringify(state)}\n\n`;
        for (const listener of listeners) listener.write(payload);
    }

    function appendLog(message: string): void {
        const timestamp = new Date().toISOString().slice(11, 23);
        const normalized = message.replace(/\r/g, '').trimEnd();
        if (!normalized) return;
        for (const line of normalized.split('\n')) {
            const entry = `${timestamp} ${line}`;
            state.logs.push(entry);
            reportLogs.push(entry);
        }
        if (state.logs.length > MAX_LOG_LINES) state.logs.splice(0, state.logs.length - MAX_LOG_LINES);
        publish();
    }

    async function inspectCoverage() {
        const prd = fs.readFileSync(prdPath, 'utf8');
        const documented = [...prd.matchAll(/^\|\s*(F\d+)\s*\|/gm)].map(match => match[1]);
        const module = await import(`${pathToFileURL(coverageModule).href}?t=${Date.now()}`);
        const mapped = module.getMappedFeatureIds() as string[];
        const documentedSet = new Set(documented);
        const mappedSet = new Set(mapped);
        return {
            documented: documented.length,
            mapped: documented.filter(id => mappedSet.has(id)).length,
            missing: documented.filter(id => !mappedSet.has(id)),
            stale: mapped.filter(id => !documentedSet.has(id)),
            suites: module.FOTOS_FLOW_SUITES,
        };
    }

    function processStep(definition: StepDefinition): Promise<{summary: string; details?: Record<string, unknown>}> {
        if (!definition.command) throw new Error(`Step ${definition.id} has no command`);
        return new Promise((resolve, reject) => {
            const child = spawn(definition.command!, definition.args ?? [], {
                cwd: browserUiRoot,
                detached: process.platform !== 'win32',
                env: {...process.env, ...definition.env},
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            activeChild = child;
            let output = '';
            const capture = (prefix: string) => (chunk: Buffer) => {
                const value = chunk.toString();
                output += value;
                appendLog(`${prefix}${value}`);
            };
            child.stdout?.on('data', capture(''));
            child.stderr?.on('data', capture('[stderr] '));
            child.once('error', error => {
                activeChild = null;
                reject(error);
            });
            child.once('exit', (code, signal) => {
                activeChild = null;
                if (stopRequested) {
                    reject(new Error('Stopped by user'));
                } else if (code === 0) {
                    const passedStages = [
                        ...[...output.matchAll(/\[stage:([^\]]+)] passed/g)].map(match => match[1]),
                        ...[...output.matchAll(/\[fotos-qa-event] \{"type":"step-pass","step":"([^"]+)"/g)].map(match => match[1]),
                    ];
                    resolve({
                        summary: passedStages.length > 0
                            ? `${passedStages.length} protocol stages passed`
                            : 'Command completed successfully',
                        details: {passedStages},
                    });
                } else {
                    reject(new Error(`${definition.title} exited with ${signal ?? `code ${code ?? 1}`}`));
                }
            });
        });
    }

    function stopChild(): void {
        const child = activeChild;
        if (!child?.pid || child.exitCode !== null) return;
        try {
            if (process.platform === 'win32') child.kill('SIGTERM');
            else process.kill(-child.pid, 'SIGTERM');
        } catch {
            child.kill('SIGTERM');
        }
    }

    function renderReport(qaReport: any): string {
        const lines = [
            '# Fotos integrated QA report',
            '',
            `- Run: ${state.runId}`,
            `- Profile: ${state.profile}`,
            `- Status: ${state.status.toUpperCase()}`,
            `- Started: ${state.startedAt}`,
            `- Finished: ${state.finishedAt ?? 'running'}`,
            `- Coverage: ${state.coverage.mapped}/${state.coverage.documented} documented flows`,
            '',
            '## Protocol steps',
            '',
            '| Step | Status | Duration | Summary |',
            '|---|---:|---:|---|',
            ...state.steps.map(step => `| ${step.title} | ${step.status} | ${step.durationMs === null ? '—' : `${(step.durationMs / 1000).toFixed(1)}s`} | ${step.summary ?? ''} |`),
            '',
        ];
        if (state.coverage.missing.length || state.coverage.stale.length) {
            lines.push('## Coverage findings', '', `- Missing: ${state.coverage.missing.join(', ') || 'none'}`, `- Stale: ${state.coverage.stale.join(', ') || 'none'}`, '');
        }
        if (qaReport?.probeResults) {
            lines.push('## qa.core probe evidence', '');
            for (const result of qaReport.probeResults) {
                lines.push(`- **${result.status.toUpperCase()}** ${result.probeId} (${result.durationMs}ms): ${result.summary}`);
            }
            lines.push('');
        }
        if (state.error) lines.push('## Failure', '', `\`${state.error}\``, '');
        lines.push('## Log', '', '```text', ...reportLogs, '```', '');
        return lines.join('\n');
    }

    async function writeReport(qaReport?: any): Promise<void> {
        if (!state.reportPath) return;
        fs.mkdirSync(reportsDir, {recursive: true});
        fs.writeFileSync(state.reportPath, renderReport(qaReport), 'utf8');
    }

    async function startRun(profile: RunnerProfile, baseUrl: string): Promise<void> {
        if (state.status === 'running') throw new Error('A fotos QA protocol is already running');
        stopRequested = false;
        const startedAt = new Date();
        const runId = startedAt.toISOString().replace(/[:.]/g, '-');
        const coverage = await inspectCoverage();
        const uiScript = path.resolve(browserUiRoot, 'tests/integration/fotos-ui-flow-suite.mjs');
        const steps: StepDefinition[] = [
            {
                id: 'flow-coverage',
                title: 'PRD flow coverage contract',
                run: async () => {
                    if (coverage.missing.length || coverage.stale.length) {
                        throw new Error(`Flow coverage mismatch; missing=${coverage.missing.join(',') || 'none'} stale=${coverage.stale.join(',') || 'none'}`);
                    }
                    return {summary: `${coverage.mapped}/${coverage.documented} flows mapped`, details: {suites: coverage.suites}};
                },
            },
            {
                id: 'browser-ui',
                title: 'Seeded desktop and mobile UI protocol',
                command: process.execPath,
                args: [uiScript],
                env: {FOTOS_QA_URL: baseUrl, FOTOS_QA_ARTIFACT_DIR: path.resolve(reportsDir, `${runId}-ui`)},
            },
        ];
        if (profile === 'full') {
            steps.push(
                {id: 'unit-contracts', title: 'UI and domain contract suite', command: process.execPath, args: ['./scripts/run-vitest.mjs', 'run']},
                {id: 'id-share', title: 'Named identity bilateral share and revocation', command: process.execPath, args: ['./tests/integration/run-fotos-id-share.mjs']},
                {id: 'adhoc-share', title: 'Ad-hoc gallery invite, sync, and revocation', command: process.execPath, args: ['./tests/integration/run-fotos-adhoc-gallery-share.mjs']},
            );
        }

        reportLogs = [];
        state = {
            runId,
            profile,
            status: 'running',
            startedAt: startedAt.toISOString(),
            finishedAt: null,
            reportPath: path.resolve(reportsDir, `fotos-${profile}-protocol-${runId}.md`),
            currentStepId: null,
            coverage: {
                documented: coverage.documented,
                mapped: coverage.mapped,
                missing: coverage.missing,
                stale: coverage.stale,
            },
            steps: steps.map(step => ({id: step.id, title: step.title, status: 'pending', startedAt: null, finishedAt: null, durationMs: null, summary: null})),
            logs: [],
            error: null,
        };
        appendLog(`[runner] ${profile} protocol ${runId} started`);
        await writeReport();

        void (async () => {
            let qaReport: any = null;
            try {
                const qaCore = await import(pathToFileURL(qaCoreModule).href);
                const runner = new qaCore.QARunner();
                for (const definition of steps) {
                    runner.registerProbe({
                        id: definition.id,
                        title: definition.title,
                        run: async () => {
                            if (stopRequested) throw new Error('Stopped by user');
                            const step = state.steps.find(item => item.id === definition.id)!;
                            state.currentStepId = definition.id;
                            step.status = 'running';
                            step.startedAt = new Date().toISOString();
                            appendLog(`[step:${definition.id}] ${definition.title}`);
                            await writeReport(qaReport);
                            const stepStartedAt = Date.now();
                            try {
                                const result = definition.run ? await definition.run() : await processStep(definition);
                                step.status = 'passed';
                                step.summary = result.summary;
                                return {status: 'passed', summary: result.summary, details: result.details};
                            } catch (error) {
                                step.status = stopRequested ? 'stopped' : 'failed';
                                step.summary = error instanceof Error ? error.message : String(error);
                                throw error;
                            } finally {
                                step.finishedAt = new Date().toISOString();
                                step.durationMs = Date.now() - stepStartedAt;
                                await writeReport(qaReport);
                            }
                        },
                    });
                }
                qaReport = await runner.run({skipContracts: true, skipTransports: true, skipParity: true, skipVerification: true});
                state.status = stopRequested ? 'stopped' : qaReport.summary.passed ? 'passed' : 'failed';
                const failures = qaReport.probeResults.filter((result: any) => result.status === 'failed');
                if (failures.length) state.error = failures.map((result: any) => `${result.probeId}: ${result.error?.message ?? result.summary}`).join('; ');
            } catch (error) {
                state.status = stopRequested ? 'stopped' : 'failed';
                state.error = error instanceof Error ? error.message : String(error);
                appendLog(`[runner] ${state.error}`);
            } finally {
                state.currentStepId = null;
                state.finishedAt = new Date().toISOString();
                appendLog(`[runner] protocol ${state.status}`);
                await writeReport(qaReport);
            }
        })();
    }

    return {
        name: 'fotos-test-runner',
        apply: 'serve',
        configureServer(server: ViteDevServer) {
            server.middlewares.use('/__fotos-tests', async (req, res, next) => {
                const url = new URL(req.url ?? '/', 'http://localhost');
                const route = url.pathname;
                if (req.method === 'GET' && (route === '/' || route === '/status')) {
                    json(res, 200, state);
                    return;
                }
                if (req.method === 'GET' && route === '/events') {
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache, no-transform');
                    res.setHeader('Connection', 'keep-alive');
                    res.write(`data: ${JSON.stringify(state)}\n\n`);
                    listeners.add(res);
                    req.on('close', () => listeners.delete(res));
                    return;
                }
                if (req.method === 'GET' && route === '/coverage') {
                    json(res, 200, await inspectCoverage());
                    return;
                }
                if (req.method === 'GET' && route === '/report') {
                    if (!state.reportPath || !fs.existsSync(state.reportPath)) {
                        json(res, 404, {error: 'No report is available yet'});
                        return;
                    }
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
                    res.setHeader('Cache-Control', 'no-store');
                    res.end(fs.readFileSync(state.reportPath, 'utf8'));
                    return;
                }
                if (req.method === 'POST' && route === '/run') {
                    try {
                        const body = await readJsonBody(req);
                        const profile = body.profile === 'full' ? 'full' : 'ui';
                        const origin = typeof body.baseUrl === 'string' && body.baseUrl.trim()
                            ? body.baseUrl.trim()
                            : `http://${req.headers.host ?? '127.0.0.1:5188'}/`;
                        await startRun(profile, origin);
                        json(res, 202, state);
                    } catch (error) {
                        json(res, 409, {error: error instanceof Error ? error.message : String(error)});
                    }
                    return;
                }
                if (req.method === 'POST' && route === '/stop') {
                    if (state.status === 'running') {
                        stopRequested = true;
                        appendLog('[runner] stop requested');
                        stopChild();
                    }
                    json(res, 200, state);
                    return;
                }
                next();
            });
        },
    };
}
