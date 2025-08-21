// /api/ping.js
module.exports = async (req, res) => {
  return res.status(200).json({ ok: true, route: '/api/ping' });
};
