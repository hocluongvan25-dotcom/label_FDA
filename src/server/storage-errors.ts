export function isObjectExists(error: {
  message: string;
  statusCode?: string | number;
}) {
  return (
    String(error.statusCode) === "409" ||
    /already exists|duplicate/i.test(error.message)
  );
}
