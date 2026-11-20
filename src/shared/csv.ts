export function downloadCsv(filename: string, columns: string[], rows: string[][]) {
  const quote = (value: string) => {
    const safe = /^[\s=+@-]/.test(value) ? `'${value}` : value
    return `"${safe.replaceAll('"', '""')}"`
  }
  const text = [columns, ...rows].map(row => row.map(quote).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
