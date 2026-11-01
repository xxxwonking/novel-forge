/** 应用级组合控件；交互由同一套 Radix/shadcn primitives 负责。 */
import * as React from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Button as PrimitiveButton } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Checkbox as PrimitiveCheckbox } from "./ui/checkbox.js";
import { Switch as PrimitiveSwitch } from "./ui/switch.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog.js";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./ui/alert-dialog.js";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select.js";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover.js";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip.js";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group.js";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet.js";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert.js";

export { Input } from "./ui/input.js";
export { Textarea } from "./ui/textarea.js";
export { Chip as StatusTag } from "./Chip.js";

export function Button({ loading = false, icon, iconPlacement, block, danger, children, className, variant = "outline", ...props }: React.ComponentProps<typeof PrimitiveButton> & {
  loading?: boolean | undefined; icon?: React.ReactNode; iconPlacement?: "start" | "end"; block?: boolean; danger?: boolean;
}) {
  const mark = loading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : icon;
  return <PrimitiveButton {...props} aria-busy={loading || undefined} disabled={props.disabled || loading}
    variant={danger && variant === "default" ? "destructive" : variant}
    className={cn(block && "w-full", danger && "text-danger-foreground", className)}>
    {iconPlacement !== "end" && mark}{children}{iconPlacement === "end" && mark}
  </PrimitiveButton>;
}

export function NumberInput({ value, onChange, ...props }: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value?: number | null; onChange?: (value: number | null) => void;
}) {
  return <Input {...props} type="number" value={value ?? ""} onChange={event => {
    const number = event.target.valueAsNumber;
    onChange?.(event.target.value === "" || !Number.isFinite(number) ? null : number);
  }} />;
}

type Option<T> = { value: T; label: React.ReactNode; disabled?: boolean };
type ChoiceProps<T> = { value?: T | null; onChange?: (value: T) => void; options: readonly Option<T>[];
  disabled?: boolean; placeholder?: string; className?: string; style?: React.CSSProperties; "aria-label"?: string; id?: string;
  mode?: "multiple"; showSearch?: boolean; allowClear?: boolean };

export function ChoiceSelect<T extends string | number>(props: ChoiceProps<T>): React.ReactElement;
export function ChoiceSelect(props: Omit<ChoiceProps<string>, "value" | "onChange"> & { mode: "multiple"; value: string[]; onChange: (value: string[]) => void }): React.ReactElement;
export function ChoiceSelect(props: ChoiceProps<string | number> | (Omit<ChoiceProps<string>, "value" | "onChange"> & { mode: "multiple"; value: string[]; onChange: (value: string[]) => void })) {
  const [query, setQuery] = React.useState("");
  if (props.mode === "multiple" && Array.isArray(props.value)) {
    const values = props.value;
    const change = props.onChange as (value: string[]) => void;
    return <Popover modal><PopoverTrigger asChild><Button id={props.id} disabled={props.disabled} role="combobox" aria-label={props["aria-label"]}
      className={cn("choice-trigger", props.className)} style={props.style}>
      <span>{values.length ? values.map(v => props.options.find(o => o.value === v)?.label ?? v).map((label,i) => <React.Fragment key={values[i]}>{i > 0 && "、"}{label}</React.Fragment>) : props.placeholder ?? "请选择"}</span><ChevronDown aria-hidden="true" className="size-4" />
    </Button></PopoverTrigger><PopoverContent className="choice-menu" align="start">
      <Input aria-label="筛选选项" placeholder="搜索…" value={query} onChange={e => setQuery(e.target.value)} />
      {props.allowClear && values.length > 0 && <Button variant="ghost" onClick={() => change([])}>清空选择</Button>}
      <div className="choice-options">{props.options.filter(o => String(o.label).toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(o => <label key={o.value} className="choice-option">
        <PrimitiveCheckbox checked={values.includes(String(o.value))} disabled={o.disabled} onCheckedChange={checked => change(checked ? [...values, String(o.value)] : values.filter(v => v !== o.value))} />{o.label}
      </label>)}</div>
    </PopoverContent></Popover>;
  }
  const selected = props.options.findIndex(o => o.value === props.value);
  return <Select value={selected < 0 ? "" : `option-${selected}`} disabled={props.disabled}
    onValueChange={key => { const item = props.options[Number(key.slice(7))]; if (item) (props.onChange as ((value: string | number) => void) | undefined)?.(item.value); }}>
    <SelectTrigger id={props.id} aria-label={props["aria-label"]} className={cn("choice-trigger", props.className)} style={props.style}><SelectValue placeholder={props.placeholder ?? "请选择"} /></SelectTrigger>
    <SelectContent>{props.options.map((o,i) => <SelectItem key={`option-${i}`} value={`option-${i}`} disabled={o.disabled}>{o.label}</SelectItem>)}</SelectContent>
  </Select>;
}

export function CheckField({ children, onChange, ...props }: Omit<React.ComponentProps<typeof PrimitiveCheckbox>, "onCheckedChange" | "onChange"> & { children?: React.ReactNode; onChange?: (checked: boolean) => void }) {
  return <label className="check-field"><PrimitiveCheckbox {...props} onCheckedChange={value => onChange?.(value === true)} />{children}</label>;
}
export function ToggleSwitch({ loading, onChange, ...props }: Omit<React.ComponentProps<typeof PrimitiveSwitch>, "onCheckedChange" | "onChange"> & { loading?: boolean; onChange?: (checked: boolean) => void }) {
  return <PrimitiveSwitch {...props} disabled={props.disabled || loading} aria-busy={loading || undefined} onCheckedChange={onChange} />;
}
export function SegmentedControl<T extends string | number>({ options, value, onChange, disabled, className, ...props }: {
  options: readonly (T | Option<T>)[]; value: T; onChange: (value: T) => void; disabled?: boolean; className?: string; "aria-label"?: string;
}) {
  const entries = options.map(o => typeof o === "object" ? o : { value: o, label: o });
  return <ToggleGroup {...props} type="single" variant="outline" value={String(value)} disabled={disabled} className={cn("segmented-control",className)} onValueChange={key => {
    const item = entries.find(o => String(o.value) === key); if (item) onChange(item.value);
  }}>{entries.map(o => <ToggleGroupItem key={String(o.value)} value={String(o.value)} aria-label={typeof o.label === "string" || typeof o.label === "number" ? String(o.label) : undefined} disabled={o.disabled}>{o.label}</ToggleGroupItem>)}</ToggleGroup>;
}
export function HelpTooltip({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  const element = React.isValidElement<{ disabled?: boolean }>(children) ? children : null;
  const interactive = element && (element.type === Button || element.type === PrimitiveButton || typeof element.type === "string" && ["button", "a", "input"].includes(element.type));
  return <Tooltip><TooltipTrigger asChild>{interactive && !element.props.disabled ? element : <span className="tooltip-target" tabIndex={0}>{children}</span>}</TooltipTrigger><TooltipContent>{title}</TooltipContent></Tooltip>;
}
/** 这些受控弹层由业务按钮打开，没有隐式 Radix Trigger，需显式归还焦点。 */
function useReturnFocus() {
  const target = React.useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => { target.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      // 路线选择器可能直接打开另一层编辑器，不抢走新弹层的焦点。
      if (!document.querySelector('[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="alert-dialog-content"]') && target.current?.isConnected) target.current.focus({ preventScroll: true });
    },
  };
}
export function DialogFrame({ open, title, children, footer, onCancel, onOk, confirmLoading, okText = "确定", cancelText = "取消", width, className, maskClosable = true }: {
  open: boolean; title: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; onCancel: () => void; onOk?: () => void;
  confirmLoading?: boolean; okText?: string; cancelText?: string; width?: number | string; className?: string; maskClosable?: boolean;
}) {
  const locked = confirmLoading || !maskClosable;
  const focus = useReturnFocus();
  return <Dialog open={open} onOpenChange={next => { if (!next && !locked) onCancel(); }}>
    <DialogContent {...focus} className={cn("app-dialog flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0",className)} style={width ? { width, maxWidth: "calc(100vw - 24px)" } : undefined}
      showCloseButton={!locked} onPointerDownOutside={event => { if (locked) event.preventDefault(); }} onEscapeKeyDown={event => { if (locked) event.preventDefault(); }} aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <div className="dialog-scroll-body">{children}</div>
      {footer !== null && <DialogFooter>{footer ?? <><Button disabled={confirmLoading} onClick={onCancel}>{cancelText}</Button><Button variant="default" loading={confirmLoading} onClick={onOk}>{okText}</Button></>}</DialogFooter>}
    </DialogContent>
  </Dialog>;
}
export function ConfirmAction({ title, description, children, onConfirm, okText = "确认", cancelText = "取消", danger }: {
  title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; onConfirm: () => void; okText?: string; cancelText?: string; danger?: boolean;
}) {
  return <AlertDialog><AlertDialogTrigger asChild>{children}</AlertDialogTrigger><AlertDialogContent>
    <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description ?? "请核对后确认此操作。"}</AlertDialogDescription></AlertDialogHeader>
    <AlertDialogFooter><AlertDialogCancel>{cancelText}</AlertDialogCancel><AlertDialogAction className={danger ? "bg-destructive text-white" : undefined} onClick={onConfirm}>{okText}</AlertDialogAction></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>;
}
export function SidePanel({ open, title, children, footer, onClose, width }: { open: boolean; title: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; onClose: () => void; width?: string | number }) {
  const focus = useReturnFocus();
  return <Sheet open={open} onOpenChange={next => { if (!next) onClose(); }}><SheetContent {...focus} className="draft-side-panel" style={{ width: width ?? 760, maxWidth: "100vw" }} aria-describedby={undefined}>
    <SheetHeader><SheetTitle>{title ?? "章节草稿"}</SheetTitle></SheetHeader><div className="dialog-scroll-body">{children}</div>{footer && <div className="dialog-footer">{footer}</div>}
  </SheetContent></Sheet>;
}
export function Notice({ message, description, type = "info", className, ...props }: { message: React.ReactNode; description?: React.ReactNode; type?: "info" | "error" | "warning" | "success"; className?: string; role?: string; style?: React.CSSProperties }) {
  return <Alert {...props} variant={type === "error" ? "destructive" : "default"} className={cn("app-notice",className)}><AlertTitle>{message}</AlertTitle>{description && <AlertDescription>{description}</AlertDescription>}</Alert>;
}
export function LoadingIndicator() { return <LoaderCircle aria-hidden="true" className="inline-block size-4 animate-spin motion-reduce:animate-none" />; }
export function Disclosure({ items, className }: { items: readonly { key: string; label: React.ReactNode; children: React.ReactNode; forceRender?: boolean }[]; className?: string }) {
  return <div className={className}>{items.map(item => <details key={item.key}><summary>{item.label}</summary>{item.children}</details>)}</div>;
}
export function InlineGroup({ children }: { children?: React.ReactNode }) { return <span className="inline-group">{children}</span>; }
