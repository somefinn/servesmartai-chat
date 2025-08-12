export default function handler(req, res) {
  const k = process.env.STRAICO_API_KEY || '';
  res.status(200).json({ hasKey: !!k, length: k.length });
}
