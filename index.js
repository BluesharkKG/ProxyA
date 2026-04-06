const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// Enable CORS so browser-based clients can call this proxy.
app.use(cors());

// Basic IP rate limiting: 60 requests per minute.
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please try again later.'
  }
});

app.use(limiter);

// Health/root endpoint.
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'proxy server is running'
  });
});

app.get('/proxy', async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing required query parameter: url' });
  }

  // Validate URL protocol and general structure.
  let target;
  try {
    target = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return res.status(400).json({ error: 'URL must start with http:// or https://' });
  }

  try {
    // Forward a small set of safe headers.
    const requestHeaders = {
      'user-agent': req.get('user-agent') || 'render-express-proxy/1.0'
    };

    const upstreamResponse = await fetch(target.toString(), {
      method: 'GET',
      headers: requestHeaders,
      redirect: 'follow'
    });

    // Forward upstream status code.
    res.status(upstreamResponse.status);

    // Forward relevant response headers (excluding hop-by-hop headers).
    const excludedHeaders = new Set([
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailers',
      'transfer-encoding',
      'upgrade'
    ]);

    upstreamResponse.headers.forEach((value, key) => {
      if (!excludedHeaders.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    if (!upstreamResponse.body) {
      return res.end();
    }

    // Stream upstream response body directly to the client.
    const readable = upstreamResponse.body;

    // In Node 18+, fetch body is a web stream; convert to Node stream for piping.
    const { Readable } = require('stream');
    Readable.fromWeb(readable).pipe(res);
  } catch (error) {
    console.error('Proxy request failed:', error);

    if (!res.headersSent) {
      return res.status(502).json({ error: 'Failed to fetch target URL' });
    }

    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy server listening on 0.0.0.0:${PORT}`);
});
