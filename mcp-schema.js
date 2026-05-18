const { spawn } = require('child_process');

const mcp = spawn('hostinger-api-mcp', [], { 
  env: { 
    ...process.env, 
    API_TOKEN: 'QiTptHOphTLyksdOOoyyFEPYipG9Dbcw4hhHGtJ0f0d953e0' 
  }
});

let buffer = '';

mcp.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop(); 
  
  for (const line of lines) {
    if (line.includes('"result"')) {
      try {
        const payload = JSON.parse(line);
        if (payload.result && payload.result.tools) {
          const t = payload.result.tools.find(t => t.name === 'DNS_deleteDNSRecordsV1');
          console.log(JSON.stringify(t.inputSchema, null, 2));
        }
      } catch (e) {}
    }
  }
});

const send = (req) => {
  mcp.stdin.write(JSON.stringify(req) + '\n');
};

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
});

setTimeout(() => {
  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  });
}, 500);

setTimeout(() => {
  mcp.kill();
  process.exit(0);
}, 2000);
