import { createFileRoute } from '@tanstack/react-router'
import { LegalList, LegalPage, LegalSection, Placeholder } from '~/components/marketing/legal-page'
import { breadcrumbSchema, pageHead } from '~/seo'

export const Route = createFileRoute('/legal/dpa')({
  head: () =>
    pageHead({
      title: 'Data processing',
      description:
        'Who is controller and who is processor when MailySend runs in your own Cloudflare ' +
        'account, plus sub-processors, transfers, security, breach notice and deletion.',
      path: '/legal/dpa',
      image: '/og/legal.png',
      jsonLd: [
        breadcrumbSchema([
          { name: 'Legal', path: '/legal/privacy' },
          { name: 'Data processing', path: '/legal/dpa' },
        ]),
      ],
    }),
  component: DpaPage,
})

function DpaPage() {
  return (
    <LegalPage
      title="Data processing"
      href="/legal/dpa"
      summary="A data processing addendum for MailySend. Its first job is to be clear that for a self-hosted deployment there is no processor to sign an addendum with — the data never leaves your account."
    >
      <LegalSection id="roles" heading="Who is who">
        <p className="m-0">
          <strong className="text-ink">Self-hosted.</strong> You deploy MailySend into your own
          Cloudflare account. Personal data in contacts, messages, events and attachments is created
          and stored there and reaches no system we operate. You are the controller (or your
          customer's processor, if you send on their behalf); Cloudflare is your processor under
          Cloudflare's own DPA. We are not a processor at all, because we process nothing. This
          document is then a template for the agreement <em>you</em> give your customers.
        </p>
        <p className="m-0">
          <strong className="text-ink">Hosted.</strong> If you use the hosted offering,{' '}
          <Placeholder>[legal entity]</Placeholder> is your processor for the personal data your
          instance holds, and the terms below apply between us.
        </p>
      </LegalSection>

      <LegalSection id="scope" heading="What is processed">
        <LegalList>
          <li>
            <strong className="text-ink">Categories of data:</strong> email addresses, names and any
            contact properties you define; message headers, subjects and bodies; attachments;
            delivery, bounce, complaint, open and click events; IP addresses and user agents
            attached to those events.
          </li>
          <li>
            <strong className="text-ink">Categories of subject:</strong> your recipients, your
            contacts, and the members of your own team who use the dashboard.
          </li>
          <li>
            <strong className="text-ink">Purpose and duration:</strong> sending, receiving and
            reporting on the mail you instruct the software to handle, for as long as your retention
            configuration keeps it.
          </li>
        </LegalList>
        <p className="m-0">
          Processing happens only on your documented instructions — an API call, a dashboard action
          or a scheduled automation you configured. There is no secondary use: no profiling, no
          training on your message content, no resale.
        </p>
      </LegalSection>

      <LegalSection id="subprocessors" heading="Sub-processors">
        <LegalList>
          <li>
            <strong className="text-ink">Cloudflare, Inc.</strong> — compute and storage for every
            deployment (Workers, Email Sending and Routing, Queues, Durable Objects, D1, KV, R2,
            Workflows, Analytics Engine).
          </li>
          <li>
            <strong className="text-ink">Any provider you configure</strong> — Amazon Web Services
            (SES) or Resend, if you route sending through them. You choose these; adding one adds a
            sub-processor to your own list.
          </li>
          <li>
            For the hosted offering only: <Placeholder>[hosted sub-processor list]</Placeholder>. We
            give notice before a new one is added, and you may object.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="transfers" heading="International transfers">
        <p className="m-0">
          Cloudflare runs the network, so transfers follow Cloudflare's arrangements — Standard
          Contractual Clauses and its Data Localisation Suite. You pick the jurisdiction for Durable
          Objects and R2 buckets at deploy time, which is the practical lever: if your data must
          stay in one region, set it there rather than relying on a promise. Where the hosted
          offering transfers data out of the EEA or UK, it does so under the SCCs with{' '}
          <Placeholder>[transfer mechanism reference]</Placeholder>.
        </p>
      </LegalSection>

      <LegalSection id="security" heading="Security measures">
        <LegalList>
          <li>
            TLS in transit and encryption at rest for every Cloudflare storage primitive used.
          </li>
          <li>
            Dashboard access behind Cloudflare Access, supporting SSO, MFA and device posture. API
            keys are scoped, stored hashed, and revocable.
          </li>
          <li>
            Least privilege by construction: the Worker's bindings are the only credentials, and
            there is no standing human access to a self-hosted deployment — including ours.
          </li>
          <li>Audit logging of dashboard, API and agent actions, with the actor attributed.</li>
          <li>
            Vulnerabilities reported through the repository's security policy are fixed in a patch
            release with an advisory.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="breach" heading="Breach notification">
        <p className="m-0">
          For the hosted offering we notify you without undue delay, and in any case within 72 hours
          of becoming aware of a personal data breach, with what we know about its nature, likely
          consequences and remediation. For a self-hosted deployment we cannot detect a breach — you
          hold the logs and the alerts — so that duty is yours, and a vulnerability in the software
          itself is disclosed publicly through the advisory process.
        </p>
      </LegalSection>

      <LegalSection id="assistance" heading="Data-subject requests and assistance">
        <p className="m-0">
          MailySend ships the mechanics rather than a ticket queue: deleting a contact cascades
          through D1, KV suppressions, R2 attachments and the event stream, and every contact,
          message and event is exportable through the API. For the hosted offering we assist you
          with access, rectification, erasure, portability, DPIAs and prior consultation, taking
          into account the nature of the processing.
        </p>
      </LegalSection>

      <LegalSection id="audit" heading="Audit">
        <p className="m-0">
          The strongest audit right available here is the source: the whole platform is MIT-licensed
          and readable before you run it. For the hosted offering we make available the information
          needed to demonstrate compliance and will accept a reasonable audit, no more than once a
          year, at your cost. Cloudflare's own certifications cover the underlying infrastructure.
        </p>
      </LegalSection>

      <LegalSection id="deletion" heading="Deletion and return on termination">
        <p className="m-0">
          Self-hosted, termination is a decision you make about your own account: export everything
          to R2 and delete the Worker, and the data goes with it. For the hosted offering we delete
          or return your personal data within 30 days of termination at your choice, except where
          law requires us to keep it, and delete existing copies at the end of that period.
        </p>
      </LegalSection>

      <LegalSection id="contact" heading="Contact">
        <p className="m-0">
          Data protection questions go to <Placeholder>[privacy contact address]</Placeholder>.
          There is no appointed <Placeholder>[DPO name, if required]</Placeholder> stated in this
          template — an operator publishing it must decide whether one is required for them.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
