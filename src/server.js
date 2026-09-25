require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/database');

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://paras.tailf684e8.ts.net';

const startServer = async () => {
  // Connect to MongoDB. The voice server starts without it, but account creation requires it.
  await connectDB();

  app.listen(PORT, () => {
    console.log('\n======================================================');
    console.log('🚀 AstraByte IVR & Outbound Calling Backend Running');
    console.log(`🌐 Local Server:       http://localhost:${PORT}`);
    console.log(`🔒 Tailscale Funnel:   ${PUBLIC_URL}`);
    console.log('------------------------------------------------------');
    console.log(`📞 Initiate Call:      POST ${PUBLIC_URL}/api/calls/initiate`);
    console.log(`🎙️  Telnyx Voice URL:   ${PUBLIC_URL}/api/telnyx/voice/webhook`);
    console.log(`💬 Telnyx SMS URL:     ${PUBLIC_URL}/api/telnyx/messaging/webhook`);
    console.log('======================================================\n');
  });
};

startServer();
