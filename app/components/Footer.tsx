export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
      Built with umain-sdlc · {currentYear}
    </footer>
  );
}
