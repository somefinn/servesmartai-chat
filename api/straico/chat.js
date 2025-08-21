// /api/straico/chat.js
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    // This lets you test the route in a browser:
    // visiting /api/straico/chat should show status 405 JSON.
    return res.status(405).json({ error: 'Use POST' });
  }

  const { messages = [] } = req.body || {};
  const lastUser =
    [...messages].reverse().find(m => m?.role === 'user')?.content ?? '';

  // Normalize to what your UI expects
  return res.status(200).json({
    choices: [{ message: { content: `echo: ${lastUser || '(empty)'}` } }]
  });
};
