import { z } from 'zod';
export declare const ConfigInputSchema: z.ZodObject<{
    $schema: z.ZodOptional<z.ZodString>;
    version: z.ZodLiteral<1>;
    baseUrl: z.ZodOptional<z.ZodString>;
    pages: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
        path: z.ZodOptional<z.ZodString>;
        readySelector: z.ZodOptional<z.ZodString>;
        consoleIgnore: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
    }, z.core.$strict>>;
    viewports: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        width: z.ZodNumber;
        height: z.ZodNumber;
        deviceScaleFactor: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    }, z.core.$strict>>;
    timeoutMs: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    output: z.ZodOptional<z.ZodDefault<z.ZodObject<{
        dir: z.ZodOptional<z.ZodDefault<z.ZodString>>;
        formats: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodEnum<{
            json: "json";
            sarif: "sarif";
        }>>>>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
//# sourceMappingURL=schema.d.ts.map