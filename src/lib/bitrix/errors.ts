export class BitrixError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
    this.name = "BitrixError";
  }
}
export function publicError(error: unknown) {
  if (error instanceof BitrixError)
    return { error: error.message, code: error.code, status: error.status };
  return {
    error:
      "Não foi possível concluir a consulta. Tente novamente em instantes.",
    code: "INTERNAL_ERROR",
    status: 500,
  };
}
