import WebSocket from 'ws';

const sid = process.argv[2]!;
const url = `ws://localhost:3000/ws/terminal?agent=claude&cols=80&rows=10`;
const ws = new WebSocket(url, { headers: { Cookie: `hermesui_sid=${sid}` } });

let got = '';
const done = () => {
  console.log(`TERMINAL_OK bytes=${got.length}`);
  process.exit(0);
};
const bail = (m: string) => {
  console.log(`TERMINAL_FAIL ${m}`);
  process.exit(1);
};

ws.on('open', () => setTimeout(() => bail('no data in 15s'), 15000));
ws.on('message', (m) => {
  const f = JSON.parse(String(m));
  if (f.type === 'data') got += f.data.length;
  if (got > 20) {
    ws.close();
    done();
  }
});
ws.on('error', (e) => bail(e.message));
