// Usage: node test-call.js +1XXXXXXXXXX
const phoneNumber = process.argv[2];

if (!phoneNumber) {
  console.log('Usage: node test-call.js <PHONE_NUMBER>');
  console.log('Example: node test-call.js +15551234567');
  process.exit(1);
}

const url = 'http://localhost:3000/api/calls/initiate';

console.log(`Sending outbound call request to: ${phoneNumber}...`);

fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to: phoneNumber }),
})
  .then(async (res) => {
    const data = await res.json();
    console.log('\nResponse status:', res.status);
    console.log('Response body:', JSON.stringify(data, null, 2));
  })
  .catch((err) => {
    console.error('Error connecting to backend:', err.message);
  });
