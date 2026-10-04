import { ImageResponse } from 'next/og'

export const alt = 'CrewWork — Open-Source Team Messaging Platform'
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = 'image/png'

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0f1115',
          backgroundImage:
            'radial-gradient(circle at 50% -10%, rgba(220, 38, 38, 0.35), transparent 60%)',
          padding: '80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '28px',
          }}
        >
          <div
            style={{
              width: '96px',
              height: '96px',
              borderRadius: '24px',
              backgroundColor: '#DC2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: '52px',
                height: '36px',
                borderRadius: '12px',
                backgroundColor: '#ffffff',
              }}
            />
          </div>
          <div
            style={{
              fontSize: 104,
              fontWeight: 700,
              color: '#ffffff',
              letterSpacing: '-3px',
              lineHeight: 1,
            }}
          >
            CrewWork
          </div>
        </div>

        <div
          style={{
            marginTop: '44px',
            fontSize: 40,
            fontWeight: 500,
            color: '#E7E5E4',
            textAlign: 'center',
          }}
        >
          Open-Source Team Messaging Platform
        </div>

        <div
          style={{
            marginTop: '40px',
            display: 'flex',
            alignItems: 'center',
            padding: '12px 28px',
            borderRadius: '999px',
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.16)',
            color: '#F5F5F4',
            fontSize: 26,
            fontWeight: 500,
          }}
        >
          Free • Self-Hosted • End-to-End Encrypted
        </div>

        <div
          style={{
            marginTop: '64px',
            fontSize: 24,
            color: '#A8A29E',
            letterSpacing: '1px',
          }}
        >
          crewwork-cp8n.onrender.com
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
