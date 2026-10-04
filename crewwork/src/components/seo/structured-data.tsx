import { GITHUB_URL, SITE_NAME, SITE_URL, faqs } from '@/lib/seo/faq'

type Schema = Record<string, unknown>

const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c')

const webApplicationSchema: Schema = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: SITE_NAME,
  url: SITE_URL,
  description:
    'Open-source team communication platform with real-time chat, video calls, AI assistant, and end-to-end encryption.',
  applicationCategory: 'CommunicationApplication',
  operatingSystem: 'Web',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  author: {
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
  },
  featureList: [
    'Real-time team messaging',
    'Video and audio calls',
    'AI-powered assistant',
    'End-to-end encryption',
    'Knowledge management',
    'Todo boards',
    'Contact management',
  ],
}

const softwareSourceCodeSchema: Schema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareSourceCode',
  name: SITE_NAME,
  codeRepository: GITHUB_URL,
  programmingLanguage: 'TypeScript',
  runtimePlatform: 'Node.js',
  license: 'https://opensource.org/licenses/MIT',
  description: 'Open-source team communication platform',
}

const organizationSchema: Schema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/favicon.svg`,
  sameAs: [GITHUB_URL],
}

const faqPageSchema: Schema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: item.answer,
    },
  })),
}

export function StructuredData() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(webApplicationSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(softwareSourceCodeSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(organizationSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqPageSchema) }} />
    </>
  )
}
