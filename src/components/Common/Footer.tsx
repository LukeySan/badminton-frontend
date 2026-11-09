export function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t px-6 py-4">
      <p className="text-center text-xs text-muted-foreground sm:text-left">
        Rally Analyzer · {currentYear}
      </p>
    </footer>
  )
}
