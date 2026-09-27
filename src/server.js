require('dotenv').config();
const os = require('os');
const app = require('./app');
const connectDB = require('./config/database');

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://paras.tailf684e8.ts.net';

function isPrivateIpv4(address) {
  return address.startsWith('10.')
    || address.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

function getLanAddress() {
  const addresses = Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    (entries || [])
      .filter((entry) => !entry.internal && (entry.family === 'IPv4' || entry.family === 4) && isPrivateIpv4(entry.address))
      .map((entry) => ({ name, address: entry.address })),
  );
  return addresses.find((entry) => /wi-?fi|wireless/i.test(entry.name))?.address
    || addresses[0]?.address
    || 'localhost';
}

const startServer = async () => {
  // Connect to MongoDB. The voice server starts without it, but account creation requires it.
  await connectDB();

  app.listen(PORT, '0.0.0.0', () => {
    console.log('\n======================================================');
    console.log('🚀 AstraByte IVR & Outbound Calling Backend Running');
    console.log(`🌐 Local Server:       http://localhost:${PORT}`);
    console.log(`📶 LAN Server:         http://${getLanAddress()}:${PORT}`);
    console.log(`🔒 Tailscale Funnel:   ${PUBLIC_URL}`);
    console.log('------------------------------------------------------');
    console.log(`📞 Initiate Call:      POST ${PUBLIC_URL}/api/calls/initiate`);
    console.log(`🎙️  Telnyx Voice URL:   ${PUBLIC_URL}/api/telnyx/voice/webhook`);
    console.log(`💬 Telnyx SMS URL:     ${PUBLIC_URL}/api/telnyx/messaging/webhook`);
    console.log('======================================================\n');
  });
};

startServer();
