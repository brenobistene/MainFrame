import { PageShell, TechId } from '../components/ui/CyberShell'

/**
 * `/arquivados` — lista simples das ideias arquivadas pelo usuário
 * (armazenadas em `localStorage` como `hq-archived-ideas`, gerenciadas
 * no `App.tsx` root). Permite remover item por item.
 */
export function ArquivadosView({ archivedIdeas, onDelete }: { archivedIdeas: Array<{ id: string; title: string; created_at: string }>; onDelete: (id: string) => void }) {
  return (
    <PageShell
      headerLabel="ARQUIVADOS"
      headerLeftContent={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 14, fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--color-text-primary)',
            lineHeight: 1.1,
          }}>
            {archivedIdeas.length} {archivedIdeas.length === 1 ? 'IDEIA' : 'IDEIAS'} GUARDADA{archivedIdeas.length !== 1 ? 'S' : ''}
          </span>
          <TechId>COLD.STORAGE · DUMP HISTORY</TechId>
        </div>
      }
      footerCaption={
        <>
          <div>// COLD.STORAGE · {archivedIdeas.length} ENTRIES</div>
          <div style={{ opacity: 0.6, marginTop: 2 }}>TYPE: TACTICAL.ARCHIVE</div>
        </>
      }
    >

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
    </PageShell>
  )
}
