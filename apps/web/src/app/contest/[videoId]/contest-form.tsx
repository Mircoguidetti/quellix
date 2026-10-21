"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MailCheck } from "lucide-react";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/input";
import { NETWORK_ERROR } from "@/lib/client-timeout";

const schema = z.object({
  message: z.string().trim().min(20, "Tell us a little more: at least 20 characters.").max(4000, "Use at most 4,000 characters."),
});

export function ContestForm({ videoId }: { videoId: string }) {
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { message: "" } });
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const onSubmit = async ({ message }: z.infer<typeof schema>) => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/contest/${videoId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return setSent(true);
      if (res.status === 409) setError("This rejection is already being reviewed. You will hear back from the company that paid you.");
      else if (res.status === 429) setError("Too many messages from this connection. Try again in an hour.");
      else setError("We could not send your message. Try again in a moment.");
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div role="status" className="grid justify-items-start gap-3 rounded-2xl border border-accept-fg/30 bg-accept-bg p-6">
        <MailCheck className="size-5 text-accept-fg" aria-hidden />
        <h2 className="text-[18px] font-medium">Your message was sent</h2>
        <p className="text-[15px] text-muted-foreground">A person will read it and decide. The company that paid you for the video will tell you the outcome.</p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
        <FormField
          control={form.control}
          name="message"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[15px]">Your message</FormLabel>
              <FormControl>
                <Textarea rows={6} maxLength={4000} placeholder="What should the reviewer know about this video?" className="text-[15px]" {...field} />
              </FormControl>
              <FormDescription>Do not include passwords or payment details.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {error && <FormAlert>{error}</FormAlert>}
        <Button type="submit" variant="pill" size="xl" className="justify-self-start" loading={sending}>
          Send to a reviewer
        </Button>
      </form>
    </Form>
  );
}
