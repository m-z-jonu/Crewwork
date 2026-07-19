export function StructuredData() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'CrewWork',
    url: 'https://crewwork-cp8n.onrender.com',
    description: 'Open-source team communication platform with real-time chat, video calls, AI assistant, and end-to-end encryption.',
    applicationCategory: 'CommunicationApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    author: {
      '@type': 'Organization',
      name: 'CrewWork',
      url: 'https://crewwork-cp8n.onrender.com',
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

  const softwareJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: 'CrewWork',
    codeRepository: 'https://github.com/m-z-jonu/Crewwork',
    programmingLanguage: 'TypeScript',
    runtimePlatform: 'Node.js',
    license: 'https://opensource.org/licenses/MIT',
    description: 'Open-source team communication platform',
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }} />
    </>
  )
}
