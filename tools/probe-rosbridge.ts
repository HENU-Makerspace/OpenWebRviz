const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=', 2);
    return [key, value];
  }),
);

const url = args.get('url') || 'wss://qiuhua.ying-guang.com/rosbridge/';
const attempts = Math.max(1, Number(args.get('attempts') || 5));
const intervalMs = Math.max(200, Number(args.get('interval') || 1000));
const timeoutMs = Math.max(1000, Number(args.get('timeout') || 5000));

type ProbeResult = {
  index: number;
  ok: boolean;
  detail: string;
  elapsedMs: number;
};

async function probe(index: number): Promise<ProbeResult> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      resolve({
        index,
        ok: false,
        detail: 'timeout',
        elapsedMs: Date.now() - startedAt,
      });
    }, timeoutMs);

    let settled = false;

    const finish = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve({
        index,
        ok,
        detail,
        elapsedMs: Date.now() - startedAt,
      });
    };

    const ws = new WebSocket(url);

    ws.onopen = () => {
      ws.close();
      finish(true, 'open');
    };

    ws.onerror = () => {
      finish(false, 'error');
    };

    ws.onclose = (event) => {
      if (!settled) {
        finish(event.wasClean, `close:${event.code}`);
      }
    };
  });
}

console.log(`rosbridge probe url=${url} attempts=${attempts} intervalMs=${intervalMs} timeoutMs=${timeoutMs}`);

const results: ProbeResult[] = [];

for (let index = 1; index <= attempts; index += 1) {
  const result = await probe(index);
  results.push(result);
  const status = result.ok ? 'ok' : 'fail';
  console.log(`#${result.index} ${status} ${result.detail} ${result.elapsedMs}ms`);
  if (index < attempts) {
    await Bun.sleep(intervalMs);
  }
}

const successCount = results.filter((result) => result.ok).length;
const failureCount = results.length - successCount;

console.log(`summary success=${successCount} failure=${failureCount}`);

if (failureCount > 0) {
  process.exit(1);
}
