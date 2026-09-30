// Usage: node test-call.js 9876543210
const mobileNumber = process.argv[2];

if (!/^\d{10}$/.test(mobileNumber || '')) {
  console.error('Enter an Indian mobile number using exactly 10 digits.');
  console.log('Usage: node test-call.js <10_DIGIT_MOBILE_NUMBER>');
  console.log('Example: node test-call.js 9876543210');
  process.exit(1);
}

const phoneNumber = `+91${mobileNumber}`;
const url = 'http://localhost:3000/api/calls/initiate';

console.log(`Sending outbound call request to mobile ending in ${mobileNumber.slice(-4)}...`);

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
