"use client";

import { createContext, useContext, useId } from "react";
import { Slot } from "radix-ui";
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { cn } from "@/lib/utils";
import { Label } from "./label";

export const Form = FormProvider;

const FieldContext = createContext<{ name: string }>({ name: "" });
const ItemContext = createContext<{ id: string }>({ id: "" });

export function FormField<V extends FieldValues, N extends FieldPath<V>>(props: ControllerProps<V, N>) {
  return (
    <FieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FieldContext.Provider>
  );
}

export function useFormField() {
  const field = useContext(FieldContext);
  const item = useContext(ItemContext);
  const { getFieldState } = useFormContext();
  const state = useFormState({ name: field.name });
  const fieldState = getFieldState(field.name, state);
  return {
    name: field.name,
    id: item.id,
    controlId: `${item.id}-control`,
    descriptionId: `${item.id}-description`,
    messageId: `${item.id}-message`,
    ...fieldState,
  };
}

export function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = useId();
  return (
    <ItemContext.Provider value={{ id }}>
      <div className={cn("grid content-start gap-2", className)} {...props} />
    </ItemContext.Provider>
  );
}

export function FormLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const { error, controlId } = useFormField();
  return <Label data-error={!!error} className={cn("data-[error=true]:text-destructive", className)} htmlFor={controlId} {...props} />;
}

export function FormControl(props: React.ComponentProps<typeof Slot.Root>) {
  const { error, controlId, descriptionId, messageId } = useFormField();
  return (
    <Slot.Root
      id={controlId}
      aria-describedby={error ? `${descriptionId} ${messageId}` : descriptionId}
      aria-invalid={!!error}
      {...props}
    />
  );
}

export function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { descriptionId } = useFormField();
  return <p id={descriptionId} className={cn("text-[13px] leading-snug text-muted-foreground", className)} {...props} />;
}

export function FormMessage({ className, children, ...props }: React.ComponentProps<"p">) {
  const { error, messageId } = useFormField();
  const body = error ? String(error.message ?? "") : children;
  if (!body) return null;
  return (
    <p id={messageId} role="alert" className={cn("text-[13px] text-destructive", className)} {...props}>
      {body}
    </p>
  );
}
