import { Card } from '../components/ui/Primitives'

/**
 * `/arquivados` — lista simples das ideias arquivadas pelo usuário
 * (armazenadas em `localStorage` como `hq-archived-ideas`, gerenciadas
 * no `App.tsx` root). Permite remover item por item.
 */
export function ArquivadosView({ archivedIdeas, onDelete }: { archivedIdeas: Array<{ id: string; title: string; created_at: string }>; onDelete: (id: string) => void }) {
  return (
    <div style={{ color: 'var(--color-text-primary)' }}>
    <Card padding="none" style={{
      animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
    }}>
      {/* Hairline accent — linha sutil oxblood no topo */}
      <div style={{
        height: 1,
        background: 'linear-gradient(90deg, transparent, var(--color-accent-primary), transparent)',
        opacity: 0.5,
      }} />
      {/* Header com gradient sutil */}
      <div style={{
        padding: 'var(--space-5) var(--space-6) var(--space-4)',
        background: `
          radial-gradient(ellipse 100% 80% at 0% 0%, rgba(159, 18, 57, 0.06), transparent 60%),
          linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
        `,
        borderBottom: '1px solid var(--color-divider)',
      }}>
      <header>
        <div style={{
          fontSize: 10, color: 'var(--color-text-tertiary)',
          letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600,
          marginBottom: 4,
        }}>
          Arquivo
        </div>
        <div style={{
          fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em',
          color: 'var(--color-text-primary)', lineHeight: 1.2,
        }}>
          Ideias guardadas
        </div>
        <div style={{
          marginTop: 8, fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: 1.5,
        }}>
          Ideias capturadas pelo Dump e guardadas pra revisitar depois.
        </div>
      </header>
      </div>
      <div style={{ padding: 'var(--space-5) var(--space-6)' }}>

      <section style={{ marginTop: 40 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18,
        }}>
          <div style={{
            fontSize: 10, color: 'var(--color-text-tertiary)',
            letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600,
          }}>
            Total arquivadas
          </div>
          <div style={{
            fontSize: 10, color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            {archivedIdeas.length}
          </div>
        </div>

        {archivedIdeas.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {archivedIdeas.map((idea, idx) => (
              <div
                key={idea.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 14,
                  padding: '12px 0',
                  borderBottom: '1px solid var(--color-divider)',
                }}
              >
                <span style={{
                  fontSize: 10, color: 'var(--color-text-muted)',
                  fontFamily: 'var(--font-mono)',
                  minWidth: 24, paddingTop: 2, textAlign: 'right',
                }}>
                  {idx + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500 }}>
                    {idea.title}
                  </div>
                  <div style={{
                    fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 3,
                    fontFamily: 'var(--font-mono)', letterSpacing: '0.05em',
                  }}>
                    arquivado em {new Date(idea.created_at).toLocaleDateString('pt-BR')}
                  </div>
                </div>
                <button
                  onClick={() => onDelete(idea.id)}
                  title="Excluir"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-text-muted)', fontSize: 11,
                    padding: '2px 8px', opacity: 0.6,
                    transition: 'color 0.15s, opacity 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '1'
                    e.currentTarget.style.color = 'var(--color-accent-primary)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '0.6'
                    e.currentTarget.style.color = 'var(--color-text-muted)'
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic',
          }}>
            Nenhuma ideia arquivada ainda.
          </div>
        )}
      </section>
      </div>
    </Card>
    </div>
  )
}
