import { createFileRoute } from '@tanstack/react-router'
import { LegalList, LegalPage, LegalSection, Placeholder } from '~/components/marketing/legal-page'
import { breadcrumbSchema, pageHead, REPO_URL } from '~/seo'

const MIT_URL = 'https://opensource.org/licenses/MIT'
const LICENCE_URL = `${REPO_URL}/blob/main/LICENSE`

export const Route = createFileRoute('/legal/terms')({
  head: () =>
    pageHead({
      title: 'Terms',
      description:
        'MailySend is MIT-licensed software provided as-is. These terms cover the licence, the ' +
        'acceptable use rules for the hosted offering, and where liability sits.',
      path: '/legal/terms',
      image: '/og/legal.png',
      jsonLd: [
        breadcrumbSchema([
          { name: 'Legal', path: '/legal/privacy' },
          { name: 'Terms', path: '/legal/terms' },
        ]),
      ],
    }),
  component: TermsPage,
})

function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      href="/legal/terms"
      summary="MailySend is MIT-licensed software you run yourself. These terms say what that licence gives you, what the hosted offering adds, and what nobody is promising."
    >
      <LegalSection id="software" heading="The software is MIT">
        <p className="m-0">
          MailySend is released under the{' '}
          <a
            href={MIT_URL}
            className="font-semibold text-accent hover:text-ink"
            rel="noreferrer noopener"
          >
            MIT licence
          </a>{' '}
          — the authoritative copy is{' '}
          <a
            href={LICENCE_URL}
            className="font-semibold text-accent hover:text-ink"
            rel="noreferrer noopener"
          >
            in the repository
          </a>
          . You may use it commercially, modify it, fork it, host it for others and resell it, as
          long as the copyright notice travels with it. Nothing on this page narrows that licence;
          where this page and the licence disagree about the software, the licence wins.
        </p>
      </LegalSection>

      <LegalSection id="as-is" heading="As-is, with no warranty">
        <p className="m-0">
          The software is provided “as is”, without warranty of any kind, express or implied,
          including merchantability, fitness for a particular purpose and non-infringement. We do
          not promise that your deployment will deliver mail, stay up, or reach any inbox. That is
          the honest trade for $0 and full source: you get to read every line before you trust it,
          and you carry the operational risk of running it.
        </p>
      </LegalSection>

      <LegalSection id="hosted" heading="The hosted offering is beta">
        <p className="m-0">
          The hosted sign-up is a convenience, not the product, and it is in beta: features may
          change or be withdrawn, and there is no uptime commitment or support obligation unless you
          have a separate written agreement with us. If we discontinue it, you can export your data
          and deploy the same software into your own Cloudflare account — that path is deliberately
          always open.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" heading="Acceptable use">
        <p className="m-0">
          These rules apply to the hosted offering and to this website. They do not, and cannot,
          apply to a copy you run yourself — but sending mail badly will get your own domain and IPs
          blocked regardless of who wrote the software.
        </p>
        <LegalList>
          <li>
            No unsolicited bulk email. Every recipient must have asked for what you are sending, and
            every marketing message must offer a working unsubscribe.
          </li>
          <li>
            No phishing, credential harvesting, impersonation of a person or brand you do not
            represent, malware, or mail that misrepresents its origin.
          </li>
          <li>
            No sending through domains you do not control, and no evading a suppression list, a
            complaint, or a provider block.
          </li>
          <li>
            No use that breaks the law where you or your recipients are, and no attempt to probe,
            overload or reverse-engineer the hosted infrastructure.
          </li>
        </LegalList>
        <p className="m-0">
          We may suspend a hosted account that breaks these rules, with notice where it is safe to
          give it.
        </p>
      </LegalSection>

      <LegalSection id="cloudflare" heading="Cloudflare governs the transport">
        <p className="m-0">
          MailySend sends through Cloudflare. Your use of Workers, Email Sending, Email Routing,
          Queues, Durable Objects, D1, KV, R2 and Workflows is governed by Cloudflare's own terms
          and billed by Cloudflare directly — we never see that bill and never take a cut of it.
          Cloudflare Email Sending is itself a public beta, which is a real risk you accept when you
          choose it as your transport; MailySend also supports Amazon SES and Resend as providers,
          each under their own terms.
        </p>
      </LegalSection>

      <LegalSection id="your-responsibilities" heading="What you are responsible for">
        <LegalList>
          <li>Your Cloudflare account, its billing, and the spend your sending volume creates.</li>
          <li>The content and lawfulness of every message your instance sends.</li>
          <li>
            Your own privacy notice and, where the law requires one, a processing agreement with
            your customers — see the{' '}
            <a href="/legal/dpa" className="font-semibold text-accent hover:text-ink">
              DPA template
            </a>
            .
          </li>
          <li>Keeping your deployment upgraded; security fixes ship as patch releases.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="liability" heading="Limitation of liability">
        <p className="m-0">
          To the fullest extent the law allows, neither the authors nor{' '}
          <Placeholder>[legal entity]</Placeholder> are liable for any indirect, incidental, special
          or consequential damages, or for lost profits, lost revenue, lost data or missed mail,
          arising from the software or the hosted offering. Where liability cannot be excluded, it
          is capped at the greater of the amount you paid us in the preceding twelve months — which
          for the free software is zero — and <Placeholder>[capped amount]</Placeholder>. Nothing
          here excludes liability for fraud, death or personal injury caused by negligence, or
          anything else that cannot lawfully be excluded.
        </p>
      </LegalSection>

      <LegalSection id="governing-law" heading="Governing law">
        <p className="m-0">
          These terms are governed by the laws of <Placeholder>[jurisdiction]</Placeholder>, and the
          courts of <Placeholder>[jurisdiction]</Placeholder> have exclusive jurisdiction. These
          placeholders are unfilled on purpose: an operator publishing this template must set them
          to their own jurisdiction rather than inherit ours.
        </p>
      </LegalSection>

      <LegalSection id="contact" heading="Contact">
        <p className="m-0">
          Questions about these terms go to <Placeholder>[legal contact address]</Placeholder>.
          Security reports go through the repository's security policy, not this address — see{' '}
          <a href="/resources#security" className="font-semibold text-accent hover:text-ink">
            Security
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  )
}
