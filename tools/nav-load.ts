import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadRobotConfig } from '../packages/server/src/config';

const execFileAsync = promisify(execFile);

const { config } = loadRobotConfig(`${process.cwd()}/packages/server/config`);
const defaultHost = String(config.jetson?.host || '192.168.1.58');

const args = new Set(process.argv.slice(2));
const intervalArg = process.argv.find((arg) => arg.startsWith('--interval='));
const hostArg = process.argv.find((arg) => arg.startsWith('--host='));
const once = args.has('--once');
const intervalMs = Math.max(1000, Number(intervalArg?.split('=')[1] || 2000));
const host = hostArg?.split('=')[1] || defaultHost;
const sshTarget = host.includes('@') ? host : `nvidia@${host}`;
const width = Math.max(24, Math.min(Number(process.stdout.columns || 120) - 56, 80));
const historySize = Math.max(20, Math.min(width, 80));

type ProcSample = {
  pid: number;
  cpu: number;
  mem: number;
  rssKb: number;
  args: string;
};

type GroupSample = {
  name: string;
  cpu: number;
  mem: number;
  rssKb: number;
  pids: number[];
};

type Snapshot = {
  now: string;
  loadavg: string;
  memLine: string;
  swapLine: string;
  tegra: string | null;
  groups: GroupSample[];
};

const GROUP_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'fastlio', pattern: /fastlio_mapping/ },
  { name: 'livox', pattern: /livox_ros_driver2_node|livox_lidar_publisher/ },
  { name: 'amcl', pattern: /\/nav2_amcl\/amcl\b| __node:=amcl\b/ },
  { name: 'controller', pattern: /\/nav2_controller\/controller_server\b| __node:=controller_server\b/ },
  { name: 'planner', pattern: /\/nav2_planner\/planner_server\b| __node:=planner_server\b/ },
  { name: 'behavior', pattern: /\/nav2_behaviors\/behavior_server\b| __node:=behavior_server\b/ },
  { name: 'bt_navigator', pattern: /\/nav2_bt_navigator\/bt_navigator\b| __node:=bt_navigator\b/ },
  { name: 'smoother', pattern: /\/nav2_smoother\/smoother_server\b| __node:=smoother_server\b/ },
  { name: 'waypoint', pattern: /\/nav2_waypoint_follower\/waypoint_follower\b| __node:=waypoint_follower\b/ },
  { name: 'velocity', pattern: /\/nav2_velocity_smoother\/velocity_smoother\b| __node:=velocity_smoother\b/ },
  { name: 'map_server', pattern: /\/nav2_map_server\/map_server\b| __node:=map_server\b/ },
  { name: 'scan_slice', pattern: /pointcloud_to_laserscan/ },
  { name: 'base_footprint', pattern: /base_footprint_projector/ },
  { name: 'scan_web', pattern: /scan_throttle/ },
  { name: 'map_web', pattern: /map_throttle/ },
  { name: 'rosbridge', pattern: /rosbridge_websocket/ },
  { name: 'mqtt', pattern: /mqtt_client/ },
  { name: 'cmd_vel', pattern: /stand_cmd_vel_converter|cmd_vel_converter/ },
  { name: 'lifecycle', pattern: /\/nav2_lifecycle_manager\/lifecycle_manager\b/ },
];

const hist = new Map<string, number[]>();

function color(text: string, code: number) {
  return `\u001b[${code}m${text}\u001b[0m`;
}

function fmtCpu(value: number) {
  return value.toFixed(1).padStart(6);
}

function fmtMem(value: number) {
  return value.toFixed(1).padStart(5);
}

function fmtRss(rssKb: number) {
  const mb = rssKb / 1024;
  return `${mb.toFixed(0)}M`.padStart(5);
}

function sparkline(values: number[]) {
  const chars = '▁▂▃▄▅▆▇█';
  const max = Math.max(100, ...values, 1);
  return values.map((value) => chars[Math.min(chars.length - 1, Math.floor((value / max) * (chars.length - 1)))]).join('');
}

function classify(args: string) {
  for (const item of GROUP_PATTERNS) {
    if (item.pattern.test(args)) return item.name;
  }
  return null;
}

async function runSSH(script: string) {
  const { stdout } = await execFileAsync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', sshTarget, script], {
    timeout: 12000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout;
}

function parseProcLine(line: string): ProcSample | null {
  const match = line.match(/^\s*(\d+)\s+([0-9.]+)\s+([0-9.]+)\s+(\d+)\s+(.+)$/);
  if (!match) return null;
  return {
    pid: Number(match[1]),
    cpu: Number(match[2]),
    mem: Number(match[3]),
    rssKb: Number(match[4]),
    args: match[5],
  };
}

async function fetchSnapshot(): Promise<Snapshot> {
  const raw = await runSSH(`
now=$(date '+%F %T')
printf 'NOW %s\n' "$now"
printf 'LOAD %s\n' "$(cat /proc/loadavg)"
free -h | awk 'NR==2 {printf "MEM %s %s %s %s %s %s\\n", $1,$2,$3,$4,$5,$6} NR==3 {printf "SWAP %s %s %s\\n", $1,$2,$3}'
if command -v tegrastats >/dev/null 2>&1; then
  printf 'TEGRA %s\n' "$(timeout 1 tegrastats 2>/dev/null | tail -n 1)"
fi
printf 'PROCS_BEGIN\n'
ps -eo pid,pcpu,pmem,rss,args --no-headers
printf 'PROCS_END\n'
`);

  const lines = raw.trim().split('\n');
  const procLines: string[] = [];
  let now = '';
  let loadavg = '';
  let memLine = '';
  let swapLine = '';
  let tegra: string | null = null;
  let inProcs = false;

  for (const line of lines) {
    if (line === 'PROCS_BEGIN') {
      inProcs = true;
      continue;
    }
    if (line === 'PROCS_END') {
      inProcs = false;
      continue;
    }
    if (inProcs) {
      procLines.push(line);
      continue;
    }
    if (line.startsWith('NOW ')) now = line.slice(4);
    else if (line.startsWith('LOAD ')) loadavg = line.slice(5);
    else if (line.startsWith('MEM ')) memLine = line.slice(4);
    else if (line.startsWith('SWAP ')) swapLine = line.slice(5);
    else if (line.startsWith('TEGRA ')) tegra = line.slice(6);
  }

  const grouped = new Map<string, GroupSample>();
  for (const line of procLines) {
    const proc = parseProcLine(line);
    if (!proc) continue;
    const name = classify(proc.args);
    if (!name) continue;
    const current = grouped.get(name) || { name, cpu: 0, mem: 0, rssKb: 0, pids: [] };
    current.cpu += proc.cpu;
    current.mem += proc.mem;
    current.rssKb += proc.rssKb;
    current.pids.push(proc.pid);
    grouped.set(name, current);
  }

  const groups = Array.from(grouped.values()).sort((a, b) => b.cpu - a.cpu);
  return { now, loadavg, memLine, swapLine, tegra, groups };
}

function updateHistory(groups: GroupSample[]) {
  const seen = new Set<string>();
  for (const group of groups) {
    const values = hist.get(group.name) || [];
    values.push(group.cpu);
    while (values.length > historySize) values.shift();
    hist.set(group.name, values);
    seen.add(group.name);
  }
  for (const [name, values] of hist.entries()) {
    if (seen.has(name)) continue;
    values.push(0);
    while (values.length > historySize) values.shift();
    hist.set(name, values);
  }
}

function groupColor(cpu: number) {
  if (cpu >= 40) return 31;
  if (cpu >= 20) return 33;
  return 36;
}

function render(snapshot: Snapshot) {
  updateHistory(snapshot.groups);
  const totalCpu = snapshot.groups.reduce((sum, group) => sum + group.cpu, 0);
  const totalMem = snapshot.groups.reduce((sum, group) => sum + group.mem, 0);
  const rows = snapshot.groups.slice(0, 14);

  const output: string[] = [];
  output.push(color('Nav Load Monitor', 1) + `  ${snapshot.now}  target=${sshTarget}`);
  output.push(`nav_cpu_sum=${totalCpu.toFixed(1)}  nav_mem_sum=${totalMem.toFixed(1)}  loadavg=${snapshot.loadavg}`);
  output.push(`mem=${snapshot.memLine}  swap=${snapshot.swapLine}`);
  if (snapshot.tegra) output.push(snapshot.tegra);
  output.push('');
  output.push('process'.padEnd(16) + 'cpu%'.padStart(6) + '  mem%'.padStart(6) + '  rss'.padStart(6) + '  pids'.padStart(10) + '  curve');

  for (const row of rows) {
    const values = hist.get(row.name) || [];
    const line = [
      color(row.name.padEnd(16), groupColor(row.cpu)),
      fmtCpu(row.cpu),
      fmtMem(row.mem),
      fmtRss(row.rssKb),
      String(row.pids.length).padStart(10),
      sparkline(values).padEnd(historySize, ' '),
    ].join('  ');
    output.push(line);
  }

  output.push('');
  output.push('Hints: q / Ctrl+C exit   --interval=1000 faster   --once snapshot');
  return output.join('\n');
}

async function main() {
  while (true) {
    try {
      const snapshot = await fetchSnapshot();
      process.stdout.write('\u001bc');
      process.stdout.write(`${render(snapshot)}\n`);
    } catch (error: any) {
      process.stdout.write('\u001bc');
      process.stdout.write(`Nav Load Monitor  target=${sshTarget}\n\n`);
      process.stdout.write(color(`fetch failed: ${error?.message || String(error)}`, 31) + '\n');
    }

    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
