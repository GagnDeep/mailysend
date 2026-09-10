import { Callout, Terminal } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { RetryBackoffVisualizer } from '~/components/guides/retry-backoff-visualizer.tsx'
import { WebhookSignaturePlayground } from '~/components/guides/webhook-signature-playground.tsx'
import { FactTable, Gotcha, Takeaway } from '~/components/marketing/guide-blocks.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono, Str } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'webhooks-end-to-end'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/webhooks-end-to-end')({
  head: () => guideHead(SLUG),
  component: Page,
})

const HEADERS: Array<[string, string]> = [
  [
    'MailySend-Signature',
    'The signature itself: t=<unix seconds>,v1=<hex>. Both parts matter — the timestamp is signed material, not metadata.',
  ],
  [
    'MailySend-Event-Id',
    'The stable identity of the event. The same id across every attempt and every replay. This is what you deduplicate on.',
  ],
  [
    'MailySend-Delivery-Id',
    'The identity of this attempt. Different on every retry and on every replay. This is what you quote in a support conversation.',
  ],
  ['Content-Type', 'Always application/json. The body is the bytes the signature covers.'],
  [
    'User-Agent',
    'MailySend-Webhook/1.0 on a real delivery. A test send from the dashboard identifies itself differently, which is how you tell the two apart in your access log.',
  ],
]

/** Attempt, what happens next, and which mechanism owns the wait. */
const LADDER: Array<[string, string, string]> = [
  ['1', 'Immediate', 'Queue'],
  ['2', '+20s', 'Queue'],
  ['3', '+40s', 'Queue'],
  ['4', '+80s', 'Queue'],
  ['5', '+160s', 'Queue'],
  ['6', '+320s', 'Queue — the last one it owns'],
  ['7', '+3h', 'Durable actor'],
  ['8', '+6h', 'Durable actor'],
  ['9', '+12h', 'Durable actor'],
  ['10', '+24h', 'Durable actor — then the delivery is abandoned'],
]

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          Your endpoint verifies an HMAC over <Mono>{'t + "." + body'}</Mono> against the raw
          request bytes, rejects anything older than five minutes, and returns 2xx quickly. The
          thing most likely to bite you later is not the signature — it is duplicates. Delivery is
          at-least-once by design, retries and replays reuse the same <Mono>event_id</Mono>, and a
          handler that is not idempotent on that id will one day charge a customer twice for one{' '}
          <Mono>email.delivered</Mono>.
        </p>
      }
    >
      {{
        'the-signature': (
          <>
            <Lede>
              Every delivery is a POST with a JSON body and three headers of ours. Only one of them
              is cryptographic, but the other two are the difference between a debuggable
              integration and a guessing game, so it is worth knowing all three before you write any
              code.
            </Lede>
            <Takeaway>
              Verify <Mono>v1</Mono> against the raw bytes, deduplicate on{' '}
              <Mono>MailySend-Event-Id</Mono>, and quote <Mono>MailySend-Delivery-Id</Mono> when you
              need to talk about one particular attempt.
            </Takeaway>
            <FactTable columns={['Header', 'What it is for']} rows={HEADERS} />
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              The signature is an HMAC-SHA256, hex-encoded, over a string built from two parts
              joined by a literal dot: the timestamp, then the exact body bytes we sent. Written
              out, the whole construction is one line.
            </p>
            <Code>
              {
                'signed_payload = t + "." + raw_request_body\nv1             = hex( HMAC_SHA256(endpoint_secret, signed_payload) )\nheader         = "t=" + t + ",v1=" + v1\n\n'
              }
              <Com>{'# MailySend-Signature: t=1767225600,v1=6f1c…9ab2'}</Com>
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Why the timestamp is inside the signed string.</strong>{' '}
              If the timestamp travelled alongside the signature rather than underneath it, an
              attacker who captured one delivery could resend it forever with a fresh timestamp and
              it would keep verifying. Because <Mono>t</Mono> is part of the message being signed,
              changing it invalidates the signature, and the only way to produce a signature for a
              new timestamp is to hold the secret. That is what makes the tolerance window
              meaningful rather than decorative.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The default tolerance is <strong className="text-ink">300 seconds</strong>. Outside
              that window the signature is still perfectly valid mathematics; the delivery is
              rejected anyway, because a request that has been sitting in someone's proxy log for an
              hour has no business being accepted.
            </p>
            <Gotcha title="A drifting clock looks exactly like a wrong secret">
              If your endpoint rejects everything with a tolerance error, check the host's clock
              before you check anything else. Ten minutes of drift fails every delivery, and the
              symptom is indistinguishable from a mistyped endpoint secret.
            </Gotcha>
            <Callout title="COMPARE IN CONSTANT TIME">
              Compare the computed hex to the received hex with a timing-safe function —{' '}
              <Mono>hmac.compare_digest</Mono> in Python, <Mono>crypto.timingSafeEqual</Mono> in
              Node, <Mono>hmac.Equal</Mono> in Go. A plain <Mono>==</Mono> returns as soon as two
              bytes differ, and that timing difference is enough to recover a valid signature one
              byte at a time. The difference is invisible in a benchmark and decisive in an attack.
            </Callout>
          </>
        ),
        'verify-it': (
          <>
            <Lede>
              Compute a signature yourself, right here, with the same construction the delivery path
              uses. Change the body by one character and watch the whole hex string change — that is
              the property the next section is about.
            </Lede>
            <WebhookSignaturePlayground />
            <p className="mt-6 text-[15.5px] leading-[1.7] text-muted">
              Now the same thing in the language your handler is actually written in. Every sample
              below does four things in the same order: parse the header, reject a stale timestamp,
              recompute the HMAC over <Mono>{'t + "." + body'}</Mono>, and compare in constant time.
              There is no SDK requirement anywhere — this is standard-library work in every one of
              them.
            </p>

            <div className="ms-eyebrow mt-5 mb-2 text-[10.5px]">NODE · TYPESCRIPT</div>
            <Code>
              <Key>import</Key>
              {' { createHmac, timingSafeEqual } '}
              <Key>from</Key> <Str>{"'node:crypto'"}</Str>
              {'\n\n'}
              <Key>export function</Key>
              {' verify(secret: string, header: string, raw: Buffer) {\n  '}
              <Key>const</Key>
              {' parts = Object.fromEntries(header.split('}
              <Str>{"','"}</Str>
              {').map((p) => p.split('}
              <Str>{"'='"}</Str>
              {')))\n  '}
              <Key>const</Key>
              {' t = Number(parts.t)\n  '}
              <Key>if</Key>
              {' (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) '}
              <Key>return false</Key>
              {'\n\n  '}
              <Com>{'// raw is the body as bytes, not a re-serialised object.'}</Com>
              {'\n  '}
              <Key>const</Key>
              {' expected = createHmac('}
              <Str>{"'sha256'"}</Str>
              {', secret)\n    .update(Buffer.concat([Buffer.from(t + '}
              <Str>{"'.'"}</Str>
              {'), raw]))\n    .digest('}
              <Str>{"'hex'"}</Str>
              {')\n  '}
              <Key>const</Key>
              {' got = Buffer.from(parts.v1 ?? '}
              <Str>{"''"}</Str>
              {')\n  '}
              <Key>return</Key>
              {' got.length === expected.length && timingSafeEqual(got, Buffer.from(expected))\n}'}
            </Code>

            <div className="ms-eyebrow mt-5 mb-2 text-[10.5px]">PYTHON</div>
            <Code>
              <Key>import</Key>
              {' hashlib, hmac, time\n\n'}
              <Key>def</Key>
              {' verify(secret: str, header: str, raw: bytes) -> bool:\n    parts = dict(p.split('}
              <Str>{'"="'}</Str>
              {', 1) '}
              <Key>for</Key>
              {' p '}
              <Key>in</Key>
              {' header.split('}
              <Str>{'","'}</Str>
              {'))\n    '}
              <Key>try</Key>
              {':\n        t = int(parts['}
              <Str>{'"t"'}</Str>
              {'])\n    '}
              <Key>except</Key>
              {' (KeyError, ValueError):\n        '}
              <Key>return False</Key>
              {'\n    '}
              <Key>if</Key>
              {' abs(time.time() - t) > 300:\n        '}
              <Key>return False</Key>
              {'\n\n    expected = hmac.new(\n        secret.encode(), f'}
              <Str>{'"{t}."'}</Str>
              {'.encode() + raw, hashlib.sha256\n    ).hexdigest()\n    '}
              <Key>return</Key>
              {' hmac.compare_digest(expected, parts.get('}
              <Str>{'"v1"'}</Str>
              {', '}
              <Str>{'""'}</Str>
              {'))'}
            </Code>

            <div className="ms-eyebrow mt-5 mb-2 text-[10.5px]">GO</div>
            <Code>
              <Key>func</Key>
              {' Verify(secret, header '}
              <Key>string</Key>
              {', raw []'}
              <Key>byte</Key>
              {') '}
              <Key>bool</Key>
              {' {\n\tparts := map['}
              <Key>string</Key>
              {']'}
              <Key>string</Key>
              {'{}\n\t'}
              <Key>for</Key>
              {' _, p := '}
              <Key>range</Key>
              {' strings.Split(header, '}
              <Str>{'","'}</Str>
              {') {\n\t\t'}
              <Key>if</Key>
              {' kv := strings.SplitN(p, '}
              <Str>{'"="'}</Str>
              {', 2); '}
              <Key>len</Key>
              {
                '(kv) == 2 {\n\t\t\tparts[kv[0]] = kv[1]\n\t\t}\n\t}\n\tt, err := strconv.ParseInt(parts['
              }
              <Str>{'"t"'}</Str>
              {'], 10, 64)\n\t'}
              <Key>if</Key>
              {' err != '}
              <Key>nil</Key>
              {' || math.Abs('}
              <Key>float64</Key>
              {'(time.Now().Unix()-t)) > 300 {\n\t\t'}
              <Key>return false</Key>
              {'\n\t}\n\n\tmac := hmac.New(sha256.New, []'}
              <Key>byte</Key>
              {'(secret))\n\tmac.Write([]'}
              <Key>byte</Key>
              {'(strconv.FormatInt(t, 10) + '}
              <Str>{'"."'}</Str>
              {'))\n\tmac.Write(raw)\n\texpected := hex.EncodeToString(mac.Sum('}
              <Key>nil</Key>
              {'))\n\t'}
              <Key>return</Key>
              {' hmac.Equal([]'}
              <Key>byte</Key>
              {'(expected), []'}
              <Key>byte</Key>
              {'(parts['}
              <Str>{'"v1"'}</Str>
              {']))\n}'}
            </Code>

            <div className="ms-eyebrow mt-5 mb-2 text-[10.5px]">RUBY</div>
            <Code>
              {'require '}
              <Str>{"'openssl'"}</Str>
              {'\n\n'}
              <Key>def</Key>
              {' verify(secret, header, raw)\n  parts = header.split('}
              <Str>{"','"}</Str>
              {').map { |p| p.split('}
              <Str>{"'='"}</Str>
              {', 2) }.to_h\n  t = Integer(parts['}
              <Str>{"'t'"}</Str>
              {'], exception: false)\n  return false '}
              <Key>if</Key>
              {' t.nil? || (Time.now.to_i - t).abs > 300\n\n  expected = OpenSSL::HMAC.hexdigest('}
              <Str>{"'SHA256'"}</Str>
              {', secret, "#{t}.#{raw}")\n  OpenSSL.secure_compare(expected, parts['}
              <Str>{"'v1'"}</Str>
              {'].to_s)\n'}
              <Key>end</Key>
            </Code>

            <div className="ms-eyebrow mt-5 mb-2 text-[10.5px]">PHP</div>
            <Code>
              <Key>function</Key>
              {' verify(string $secret, string $header, string $raw): bool {\n  $parts = [];\n  '}
              <Key>foreach</Key>
              {' (explode('}
              <Str>{"','"}</Str>
              {', $header) '}
              <Key>as</Key>
              {' $p) {\n    [$k, $v] = array_pad(explode('}
              <Str>{"'='"}</Str>
              {', $p, 2), 2, '}
              <Str>{"''"}</Str>
              {');\n    $parts[trim($k)] = trim($v);\n  }\n  $t = (int)($parts['}
              <Str>{"'t'"}</Str>
              {'] ?? 0);\n  '}
              <Key>if</Key>
              {' ($t === 0 || abs(time() - $t) > 300) '}
              <Key>return false</Key>
              {';\n\n  $expected = hash_hmac('}
              <Str>{"'sha256'"}</Str>
              {', $t . '}
              <Str>{"'.'"}</Str>
              {' . $raw, $secret);\n  '}
              <Key>return</Key>
              {' hash_equals($expected, $parts['}
              <Str>{"'v1'"}</Str>
              {'] ?? '}
              <Str>{"''"}</Str>
              {');\n}'}
            </Code>

            <div className="ms-eyebrow mt-5 mb-2 text-[10.5px]">JAVA</div>
            <Code>
              <Key>boolean</Key>
              {
                ' verify(String secret, String header, byte[] raw) throws Exception {\n  Map<String, String> parts = new HashMap<>();\n  '
              }
              <Key>for</Key>
              {' (String p : header.split('}
              <Str>{'","'}</Str>
              {')) {\n    String[] kv = p.split('}
              <Str>{'"="'}</Str>
              {', 2);\n    '}
              <Key>if</Key>
              {' (kv.length == 2) parts.put(kv[0].trim(), kv[1].trim());\n  }\n  '}
              <Key>long</Key>
              {' t = Long.parseLong(parts.getOrDefault('}
              <Str>{'"t"'}</Str>
              {', '}
              <Str>{'"0"'}</Str>
              {'));\n  '}
              <Key>if</Key>
              {' (Math.abs(Instant.now().getEpochSecond() - t) > 300) '}
              <Key>return false</Key>
              {';\n\n  Mac mac = Mac.getInstance('}
              <Str>{'"HmacSHA256"'}</Str>
              {');\n  mac.init(new SecretKeySpec(secret.getBytes(UTF_8), '}
              <Str>{'"HmacSHA256"'}</Str>
              {'));\n  mac.update((t + '}
              <Str>{'"."'}</Str>
              {
                ').getBytes(UTF_8));\n  String expected = HexFormat.of().formatHex(mac.doFinal(raw));\n  '
              }
              <Key>return</Key>
              {' MessageDigest.isEqual(\n    expected.getBytes(UTF_8), parts.getOrDefault('}
              <Str>{'"v1"'}</Str>
              {', '}
              <Str>{'""'}</Str>
              {').getBytes(UTF_8));\n}'}
            </Code>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              Notice what none of them do: none parse the JSON before verifying, and none
              reconstruct the body from a parsed object. Every one takes the bytes it was handed.
              That is not stylistic.
            </p>
          </>
        ),
        'raw-body': (
          <>
            <Lede>
              This is the one that costs everybody an afternoon exactly once. The signature covers
              the bytes we transmitted. Your framework, helpfully, has already turned those bytes
              into an object by the time your handler runs — and turning that object back into a
              string does not give you the bytes back.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              JSON serialisation is not canonical. Key order can change, a space after a colon can
              appear or vanish, a non-ASCII character may come back <Mono>{'\\u00e9'}</Mono> instead
              of <Mono>é</Mono>, a float may be reprinted with a different number of digits, and a
              trailing newline may be dropped. Every one of those produces a byte string that is a
              perfectly valid encoding of the same data and a completely different HMAC. Not a
              nearly-matching one — HMAC has no notion of nearly. One flipped byte anywhere and the
              hex output is unrecognisable.
            </p>
            <Code>
              <Com>{'# what we signed and sent'}</Com>
              {'\n{"type":"email.delivered","data":{"email_id":"em_7Kq2xR"}}\n\n'}
              <Com>{'# what JSON.stringify(req.body) hands back'}</Com>
              {'\n{"type":"email.delivered","data":{"email_id":"em_7Kq2xR"}}\n\n'}
              <Com>{'# identical here — and not identical the day someone adds an accent,'}</Com>
              {'\n'}
              <Com>{'# a number with a fractional part, or a differently ordered key.'}</Com>
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              That is the cruel part: a round-trip through your JSON parser usually matches, which
              is why the bug ships. It fails later, in production, on the one event type that
              carries a customer's name with a diaeresis in it, and it fails as a signature error
              rather than as an encoding error, so you spend the afternoon looking at your secret.
            </p>
            <Callout variant="warn" title="CAPTURE THE BYTES BEFORE THE PARSER RUNS">
              In Express, mount <Mono>express.raw({'{ type: "application/json" }'})</Mono> on the
              webhook route only, above your global <Mono>express.json()</Mono>. In Next.js App
              Router, call <Mono>await request.text()</Mono> and parse it yourself afterwards. In
              Fastify, add a content-type parser that keeps the buffer. In Django, read{' '}
              <Mono>request.body</Mono> and never <Mono>request.POST</Mono>. In Rails, use{' '}
              <Mono>request.raw_post</Mono>. The rule is identical everywhere: verify, then parse —
              never parse, then verify.
            </Callout>
            <Code>
              <Com>{'// Express — the raw parser is scoped to this one route.'}</Com>
              {'\napp.post(\n  '}
              <Str>{"'/hooks/mailysend'"}</Str>
              {',\n  express.raw({ type: '}
              <Str>{"'application/json'"}</Str>
              {' }),\n  (req, res) => {\n    '}
              <Key>const</Key>
              {' header = req.get('}
              <Str>{"'mailysend-signature'"}</Str>
              {') ?? '}
              <Str>{"''"}</Str>
              {'\n    '}
              <Key>if</Key>
              {' (!verify(process.env.WEBHOOK_SECRET, header, req.body)) {\n      '}
              <Key>return</Key>
              {' res.status(400).send('}
              <Str>{"'bad signature'"}</Str>
              {')\n    }\n    '}
              <Key>const</Key>
              {' event = JSON.parse(req.body.toString('}
              <Str>{"'utf8'"}</Str>
              {'))  '}
              <Com>{'// now it is safe'}</Com>
              {'\n    …\n  },\n)'}
            </Code>
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                While you are here: make the handler idempotent on the event id.
              </strong>{' '}
              Delivery is at-least-once, which is the honest guarantee — the alternative, exactly
              once, would require us to know that your handler committed, and a response that never
              arrives is indistinguishable from a response that was never sent. So the same event
              can reach you twice: your handler succeeded but the response timed out on the way
              back, a retry was already in flight, or somebody pressed replay.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Every event carries a stable <Mono>MailySend-Event-Id</Mono>, and it is stable across
              all of those cases — retries reuse it, and a replay deliberately reuses it too, taking
              a fresh delivery id instead. So the contract is simple: store the event id with a
              unique constraint and let the insert conflict tell you it is a duplicate. Do that
              before the side effect, not after.
            </p>
            <Code>
              <Key>INSERT INTO</Key>
              {' processed_events (event_id, seen_at)\n'}
              <Key>VALUES</Key>
              {' (?, ?)\n'}
              <Key>ON CONFLICT</Key>
              {' (event_id) '}
              <Key>DO NOTHING</Key>
              {';\n'}
              <Com>{'-- zero rows affected → you have already handled this one. Return 200.'}</Com>
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Return 2xx as soon as you have durably recorded the event, and do the slow work
              afterwards. The delivery request is abandoned after ten seconds; a handler that
              renders a PDF inline will be marked failed, retried, and will render the PDF again.
            </p>
          </>
        ),
        retries: (
          <>
            <Lede>
              "We retry with backoff" tells you nothing about whether your endpoint being down over
              lunch loses data. Here is the actual shape, with the actual numbers, so you can answer
              that for yourself.
            </Lede>
            <Takeaway>
              Six attempts on the queue over about ten minutes, then four more from a durable actor
              across a day. Twenty consecutive failures with no success in between disables the
              endpoint.
            </Takeaway>
            <RetryBackoffVisualizer />
            <FactTable
              columns={['Attempt', 'When', 'Who is holding it']}
              rows={LADDER}
              caption="The queue's delay is min(10 × 2ⁿ, 3600) seconds, so the hour cap is defensive — six attempts never reach it. The tail is a fixed schedule, and a delivery still failing after +24h is recorded as abandoned."
            />
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                There are two mechanisms because no single one fits.
              </strong>{' '}
              The queue ladder exists to absorb a deploy, a container restart, or one momentary 502,
              and it should be invisible to you. A queue cannot hold a message for a day, so
              anything still failing is handed to a durable actor that owns the long tail. An alarm
              is the wrong tool for a delivery that will succeed on the second attempt, and a queue
              is the wrong tool for one that needs to wait until tomorrow.
            </p>
            <FactTable
              columns={['What we record per attempt', 'Detail']}
              monoFirst={false}
              rows={[
                [
                  'Success',
                  'Any 2xx, and nothing else. A successful delivery is the only outcome that is not retried.',
                ],
                [
                  'Failure',
                  'A 4xx, a 5xx, a TLS failure, a DNS failure, or a connection that hangs past the ten-second timeout. A 410 means nothing special — if you want an endpoint to stop, delete it rather than answering rudely.',
                ],
                [
                  'Attempt number and status',
                  'Stored on the delivery row and shown in the dashboard.',
                ],
                ['Duration', 'In milliseconds, per attempt.'],
                [
                  'The first 4 KB of your response body',
                  'Deliberate, and the fastest debugging tool here: if your handler returns its stack trace in the body, you read the stack trace next to the failed delivery instead of correlating timestamps across two systems. Four kilobytes because it is there to help you debug, not to archive your application’s output.',
                ],
              ]}
            />
            <Terminal
              lines={[
                {
                  kind: 'command',
                  text: 'curl -s $BASE/v1/webhooks/wh_3Qd/deliveries -H "Authorization: Bearer $KEY"',
                },
                { kind: 'output', text: '{ "data": [' },
                {
                  kind: 'output',
                  text: '  { "attempt": 3, "status": "failed",    "response_status": 502, "duration_ms": 118 },',
                },
                {
                  kind: 'output',
                  text: '  { "attempt": 4, "status": "delivered", "response_status": 200, "duration_ms": 94 }',
                },
                { kind: 'output', text: '] }' },
              ]}
            />
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              A successful delivery resets the consecutive-failure counter to zero. This matters
              more than it sounds: an endpoint that fails nineteen times over three weeks and
              succeeds in between is never disabled, because it is flaky rather than gone. The
              counter measures a run, not a total.
            </p>
          </>
        ),
        'disable-and-replay': (
          <>
            <Lede>
              Twenty consecutive failures — no success anywhere in between — and the endpoint is
              disabled. Deliveries stop, the reason and the time are recorded, and nothing is lost
              that you cannot get back.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Twenty in a row is not a flaky handler. It is a handler that has been deleted, a
              domain that has expired, or a certificate that stopped renewing three weeks ago.
              Continuing to POST at it for days would be pure waste on both sides — ours in queue
              time, yours in log noise and, if the hostname has since been re-registered by somebody
              else, in sending your delivery events to a stranger. Disabling is the safe failure,
              and it is loud: the endpoint shows as disabled with the timestamp it happened, so it
              is a state you can see rather than a silence you have to notice.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Re-enabling clears the counter, so a fixed endpoint starts from zero rather than one
              failure away from being switched off again.
            </p>
            <Callout title="THE RECOVERY, IN ORDER">
              Fix the receiver. Send a test delivery — it is signed exactly like a real one and is
              delivered inline, so you get the status code and your own response body back in the
              same HTTP call rather than having to hunt for a row. Then re-enable. Then replay the
              window you missed. Replaying into a receiver that is still broken just spends your
              retry budget again.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Replay takes a delivery and tries it again. The important detail is what it keeps and
              what it changes: the <Mono>event_id</Mono> is the same — it is the same event, and a
              consumer that deduplicates on the event id must see the replay as something it already
              knows about rather than as a second incident — while the delivery id is new, so the
              two attempts stay distinguishable in your logs and ours.
            </p>
            <Code>
              <Key>POST</Key>
              {' /v1/webhooks/'}
              <Str>{'wh_3Qd'}</Str>
              {'/deliveries/'}
              <Str>{'del_8Xz'}</Str>
              {'/replay\n\n'}
              <Com>{'{'}</Com>
              {'\n  '}
              <Key>{'"id"'}</Key>
              {': '}
              <Str>{'"del_9Fb"'}</Str>
              {',          '}
              <Com>{'// new attempt'}</Com>
              {'\n  '}
              <Key>{'"event_id"'}</Key>
              {': '}
              <Str>{'"ev_2Ln"'}</Str>
              {',    '}
              <Com>{'// unchanged — dedupe on this'}</Com>
              {'\n  '}
              <Key>{'"replay_of"'}</Key>
              {': '}
              <Str>{'"del_8Xz"'}</Str>
              {',\n  '}
              <Key>{'"status"'}</Key>
              {': '}
              <Str>{'"pending"'}</Str>
              {'\n'}
              <Com>{'}'}</Com>
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">One honest limit.</strong> Replay rebuilds the body from
              the stored event, so it needs that event to still be in the detail store. Past that
              retention it cannot be replayed and the API says so explicitly rather than delivering
              you a plausible-looking reconstruction — the error names <Mono>/v1/exports</Mono> as
              where to retrieve it from the archive instead. A webhook body invented after the fact
              would be worse than an error, because you would have no way to tell it apart from a
              real one.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              If you are wiring up the credential side of this as well, the{' '}
              <a
                href="/guides/api-keys-and-environments"
                className="text-accent underline underline-offset-4"
              >
                API keys guide
              </a>{' '}
              covers rotation, and endpoint secrets rotate on the same principle: overlap, cut over,
              revoke.
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
