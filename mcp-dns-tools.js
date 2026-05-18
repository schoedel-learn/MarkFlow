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
          const tools = payload.result.tools;
          const dnsTools = tools.filter(t => t.name.toLowerCase().includes('dns') || t.name.toLowerCase().includes('record') || t.name.toLowerCase().includes('zone'));
          console.log("Found DNS Tools:");
          dnsTools.forEach(t => console.log(t.name, t.description));
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
