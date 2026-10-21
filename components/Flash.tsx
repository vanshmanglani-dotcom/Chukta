export function Flash({ msg, err }: { msg?: string; err?: string }) {
  return (
    <>
      {msg && <div className="flash">{msg}</div>}
      {err && <div className="flash err">{err}</div>}
    </>
  );
}
