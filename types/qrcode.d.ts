declare module "qrcode/lib/core/qrcode.js" {
  interface QRCodeSymbol {
    modules: {
      size: number;
      data: Uint8Array;
      get(row: number, column: number): number;
    };
    version: number;
    maskPattern: number;
  }

  interface QRCodeOptions {
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    version?: number;
    maskPattern?: number;
  }

  const QRCode: {
    create(value: string, options?: QRCodeOptions): QRCodeSymbol;
  };

  export default QRCode;
}
