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
    if (line.trim()) {
      console.log(`RECV: ${line}`);
    }
  }
});

mcp.stderr.on('data', (data) => {
  console.error(`ERR: ${data}`);
});

const send = (req) => {
  console.log(`SEND: ${JSON.stringify(req)}`);
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
    method: 'tools/call',
    params: {
      name: 'DNS_getDNSRecordsV1',
      arguments: {
        domain: 'schoedeldesign.ai'
      }
    }
  });
}, 500);

setTimeout(() => {
  mcp.kill();
  process.exit(0);
}, 3000);
