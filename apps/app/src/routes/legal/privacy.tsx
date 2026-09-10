import { createFileRoute } from '@tanstack/react-router'
import { LegalList, LegalPage, LegalSection, Placeholder } from '~/components/marketing/legal-page'
import { breadcrumbSchema, pageHead } from '~/seo'

export const Route = createFileRoute('/legal/privacy')({
  head: () =>
    pageHead({
      title: 'Privacy',
      description:
        'What mailysend.com collects (almost nothing), and why a self-hosted MailySend keeps its ' +
        'email data in your own Cloudflare account where we cannot reach it.',
      path: '/legal/privacy',
      image: '/og/legal.png',
      jsonLd: [
        breadcrumbSchema([
          { name: 'Legal', path: '/legal/privacy' },
          { name: 'Privacy', path: '/legal/privacy' },
        ]),
      ],
    }),
  component: PrivacyPage,
})

function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      href="/legal/privacy"
      summary="What this website collects, what a MailySend instance stores, and why those are two different questions with two different answers."
    >
      <LegalSection id="who" heading="Who this covers">
        <p className="m-0">
          This notice covers <strong className="text-ink">mailysend.com</strong> — the marketing and
          documentation site you are reading — and the hosted sign-up at <code>/sign-up</code>, both
          operated by <Placeholder>[legal entity]</Placeholder> of{' '}
          <Placeholder>[registered address]</Placeholder>.
        </p>
        <p className="m-0">
          It does not cover a MailySend instance you deploy. That software runs in <em>your</em>{' '}
          Cloudflare account, under your own privacy notice, and we have no access to it.
        </p>
      </LegalSection>

      <LegalSection id="site" heading="What the website collects">
        <LegalList>
          <li>
            <strong className="text-ink">Request logs.</strong> Cloudflare records the usual edge
            log for every request — IP address, user agent, URL, timestamp, response status — to
            serve the page and to stop abuse. We keep no separate copy.
          </li>
          <li>
            <strong className="text-ink">Nothing else by default.</strong> There is no analytics
            script, no advertising pixel, no session replay, and no third-party embed on the
            marketing or documentation pages.
          </li>
          <li>
            <strong className="text-ink">What you type into a form.</strong> If you sign in or claim
            a hosted instance at <code>/setup</code>, we process the email address you give us so we
            can send you a one-time code and associate your deployment with you.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="cookies" heading="Cookies">
        <p className="m-0">
          The marketing and documentation pages set no cookies at all — they are static HTML. The
          only cookie MailySend sets is the session cookie issued after you sign in at{' '}
          <a href="/sign-in" className="font-semibold text-accent hover:text-ink">
            /sign-in
          </a>
          . It is strictly necessary, first-party, and expires when the session does. There is no
          consent banner because there is nothing to consent to.
        </p>
      </LegalSection>

      <LegalSection id="self-hosted" heading="Self-hosted instances: your data, your account">
        <p className="m-0">
          When you deploy MailySend, every piece of email data lives in Cloudflare resources you
          own: messages and events in D1, suppressions and keys in KV, attachments and exports in
          R2, aggregates in Analytics Engine, and per-mailbox state in Durable Objects. It is
          created by your Worker, in the region you chose, under your Cloudflare account.
        </p>
        <p className="m-0">
          In data-protection terms that makes <strong className="text-ink">you</strong> the
          controller and <strong className="text-ink">Cloudflare</strong> your processor. We are
          neither. We ship no telemetry on message content, hold no production credentials for your
          deployment, and could not produce your data if we were asked for it. The{' '}
          <a href="/legal/dpa" className="font-semibold text-accent hover:text-ink">
            data processing terms
          </a>{' '}
          set out the roles in full.
        </p>
      </LegalSection>

      <LegalSection id="hosted" heading="The hosted offering">
        <p className="m-0">
          If you use the hosted offering rather than deploying yourself, we process the personal
          data your instance holds — contact records, message metadata and delivery events — solely
          to run the service on your instructions. We are your processor for that data, and the same
          deletion and export routes described below apply.
        </p>
      </LegalSection>

      <LegalSection id="legal-basis" heading="Legal basis and retention">
        <LegalList>
          <li>
            <strong className="text-ink">Legitimate interests</strong> for edge request logs
            (serving the site and preventing abuse), retained for as long as Cloudflare's edge
            logging retains them.
          </li>
          <li>
            <strong className="text-ink">Contract</strong> for the account email address and session
            cookie, retained while your account exists and deleted within 30 days of you closing it.
          </li>
          <li>
            Retention inside a MailySend instance is a configuration value you set at deploy, not a
            plan feature we control.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="sharing" heading="Who else sees it">
        <p className="m-0">
          Cloudflare hosts the site and the software. If your instance is configured to send through
          Amazon SES or Resend, those providers receive the messages you route to them under their
          own terms. We sell nothing, share nothing with advertisers, and have no other
          sub-processors for the website.
        </p>
      </LegalSection>

      <LegalSection id="rights" heading="Your rights">
        <p className="m-0">
          Depending on where you live you may have rights of access, correction, deletion,
          portability, restriction and objection. For data we hold, write to{' '}
          <Placeholder>[privacy contact address]</Placeholder> and we will answer within one month.
          For data inside a self-hosted instance, the request belongs to whoever operates that
          instance — deleting a contact there cascades through D1, KV suppressions, R2 attachments
          and the event stream.
        </p>
        <p className="m-0">
          If you are unhappy with our answer you may complain to your supervisory authority in{' '}
          <Placeholder>[jurisdiction]</Placeholder>.
        </p>
      </LegalSection>

      <LegalSection id="changes" heading="Changes">
        <p className="m-0">
          Changes are published here with a new date at the top, and material changes are noted in
          the{' '}
          <a href="/resources#changelog" className="font-semibold text-accent hover:text-ink">
            changelog
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  )
}
