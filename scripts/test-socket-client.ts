import { io } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import config from '../src/config/index.js';

// Run: npx ts-node --esm scripts/test-socket-client.ts <USER_ID>
// Ex: npx ts-node --esm scripts/test-socket-client.ts 65d78a8f812b1a1c9a123456

const targetUserId = process.argv[2];

if (!targetUserId) {
    console.error('Please provide a User ID as an argument.');
    console.log('Usage: npx ts-node --esm scripts/test-socket-client.ts <USER_ID>');
    process.exit(1);
}

// Forge a JWT for the requested user
const token = jwt.sign(
    { userId: targetUserId, sessionId: 'test-session' },
    config.jwt.accessSecret,
    { expiresIn: '1h' }
);

console.log(`Connecting to WS server as user: ${targetUserId}...`);

const socket = io('http://localhost:3000', {
    auth: { token },
    transports: ['websocket'],
});

socket.on('connect', () => {
    console.log(`✅ Connected successfully with socket ID: ${socket.id}`);
    console.log('Waiting for notification events...\n');
});

socket.on('connect_error', (err) => {
    console.error(`❌ Connection error: ${err.message}`);
});

socket.on('notification', (data) => {
    console.log('\n🔔 --- NEW NOTIFICATION EVENT --- 🔔');
    console.log(JSON.stringify(data, null, 2));
    console.log('------------------------------------\n');
});

socket.on('disconnect', (reason) => {
    console.log(`🔌 Disconnected: ${reason}`);
});
