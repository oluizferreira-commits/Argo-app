/**
 * Entrega um arquivo ao usuário. No iPhone usa a folha de compartilhamento
 * (permite "Salvar em Arquivos", AirDrop, WhatsApp, e-mail...). Fora disso, baixa o arquivo.
 * Retorna false se o usuário cancelou.
 */
export async function saveFile(name: string, content: string | Blob, mime = 'application/json'): Promise<boolean> {
  const file = new File([content], name, { type: content instanceof Blob && content.type ? content.type : mime })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
      return true
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return false
      // Outros erros: cai para o download comum.
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}

export function readFileText(file: File): Promise<string> {
  return file.text()
}
