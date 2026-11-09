import { zodResolver } from "@hookform/resolvers/zod"
import { Film, Home, Plus, Settings, Trash2, Upload } from "lucide-react"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
} from "@/components/ui/button-group"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { PasswordInput } from "@/components/ui/password-input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Section } from "./TokenSections"

const Row = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-2">{children}</div>
)

export function ComponentGallery() {
  return (
    <>
      <Section title="Button">
        <Row>
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="destructive">
            <Trash2 />
            Destructive
          </Button>
        </Row>
        <Row>
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Add">
            <Plus />
          </Button>
          <Button disabled>Disabled</Button>
          <LoadingButton loading>Saving</LoadingButton>
        </Row>
      </Section>

      <Section title="ButtonGroup">
        <Row>
          <ButtonGroup>
            <Button size="sm">Time</Button>
            <Button size="sm" variant="outline">
              Longest
            </Button>
          </ButtonGroup>
          <ButtonGroup>
            <ButtonGroupText>Speed</ButtonGroupText>
            <ButtonGroupSeparator />
            <Button size="sm" variant="outline">
              1×
            </Button>
          </ButtonGroup>
        </Row>
      </Section>

      <Section title="Switch, Toggle, ToggleGroup">
        <Row>
          <Label className="gap-2">
            <Switch defaultChecked /> Skip breaks
          </Label>
          <Label className="gap-2">
            <Switch /> Off
          </Label>
          <Label className="gap-2">
            <Switch disabled /> Disabled
          </Label>
        </Row>
        <Row>
          <Toggle aria-label="Bold" defaultPressed>
            Pressed
          </Toggle>
          <Toggle aria-label="Plain">Toggle</Toggle>
          <ToggleGroup type="single" defaultValue="time" variant="outline">
            <ToggleGroupItem value="time">Time</ToggleGroupItem>
            <ToggleGroupItem value="longest">Longest</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" defaultValue="all">
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="5">5s+</ToggleGroupItem>
            <ToggleGroupItem value="10">10s+</ToggleGroupItem>
          </ToggleGroup>
        </Row>
      </Section>

      <Section title="ScrollArea">
        <ScrollArea className="h-32 rounded-lg border">
          <ul className="divide-y text-sm tabular-nums">
            {Array.from({ length: 12 }, (_, i) => (
              <li key={i} className="flex justify-between px-3 py-2">
                <span className="font-bold text-muted-foreground">
                  #{i + 1}
                </span>
                <span>{(3 + ((i * 7) % 11) / 2).toFixed(1)} s</span>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </Section>

      <Section title="Badge">
        <Row>
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </Row>
      </Section>

      <Section title="Alert">
        <Alert>
          <AlertTitle>Part of your court is out of frame</AlertTitle>
          <AlertDescription>Results may be less accurate.</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertTitle>Analysis failed</AlertTitle>
          <AlertDescription>
            Worker crashed while tracking frame 5123.
          </AlertDescription>
        </Alert>
      </Section>

      <Section title="Card">
        <Card>
          <CardHeader>
            <CardTitle>match5_720.mp4</CardTitle>
            <CardDescription>21:24 · 73 rallies</CardDescription>
            <CardAction>
              <Badge variant="secondary">Ready</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="text-sm">
            Card content on bg-card.
          </CardContent>
          <CardFooter>
            <Button size="sm">Watch</Button>
          </CardFooter>
        </Card>
      </Section>

      <Section title="Input, PasswordInput, Label, Checkbox, Select">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Email</Label>
            <Input placeholder="you@example.com" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Password</Label>
            <PasswordInput placeholder="Password" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Disabled</Label>
            <Input disabled value="Can't edit" readOnly />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Minimum length</Label>
            <Select defaultValue="5">
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Any length</SelectItem>
                <SelectItem value="5">5 s or longer</SelectItem>
                <SelectItem value="10">10 s or longer</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Row>
          <Label className="gap-2">
            <Checkbox defaultChecked /> Checked
          </Label>
          <Label className="gap-2">
            <Checkbox /> Unchecked
          </Label>
          <Label className="gap-2">
            <Checkbox disabled /> Disabled
          </Label>
        </Row>
      </Section>

      <Section title="Form (react-hook-form + zod, with an error)">
        <FormExample />
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="rallies">
          <TabsList>
            <TabsTrigger value="rallies">Rallies</TabsTrigger>
            <TabsTrigger value="stats">Stats</TabsTrigger>
          </TabsList>
          <TabsContent value="rallies" className="text-sm">
            Rally list tab
          </TabsContent>
          <TabsContent value="stats" className="text-sm">
            Stats tab
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Start</TableHead>
              <TableHead className="text-right">Length</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="tabular-nums">
            <TableRow>
              <TableCell>11</TableCell>
              <TableCell>4:02</TableCell>
              <TableCell className="text-right">3.1 s</TableCell>
            </TableRow>
            <TableRow data-state="selected">
              <TableCell>12</TableCell>
              <TableCell>4:12</TableCell>
              <TableCell className="text-right">8.4 s</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Section>

      <Section title="Pagination">
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#" />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#">1</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#" isActive>
                2
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
            <PaginationItem>
              <PaginationNext href="#" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </Section>

      <Section title="Progress, Skeleton, Separator, Avatar">
        <div className="flex flex-col gap-2">
          <Progress value={0} aria-label="0%" />
          <Progress value={42} aria-label="42%" />
          <Progress value={100} aria-label="100%" />
        </div>
        <Row>
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="size-10 rounded-full" />
        </Row>
        <Separator />
        <Row>
          <Avatar>
            <AvatarFallback>BL</AvatarFallback>
          </Avatar>
          <Separator orientation="vertical" className="h-6" />
          <span className="text-sm text-muted-foreground">Avatar fallback</span>
        </Row>
      </Section>

      <Section title="Sidebar (as on desktop)">
        <SidebarProvider className="min-h-0">
          <Sidebar collapsible="none" className="h-auto rounded-lg border">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>Rally Analyzer</SidebarGroupLabel>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive>
                      <Film />
                      Videos
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton>
                      <Upload />
                      Upload
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton>
                      <Settings />
                      Settings
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
        </SidebarProvider>
      </Section>

      <Section title="Overlays (open outside this panel, in the app's theme)">
        <Row>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Tooltip</Button>
            </TooltipTrigger>
            <TooltipContent>Next rally (→)</TooltipContent>
          </Tooltip>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Dropdown</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Video</DropdownMenuLabel>
              <DropdownMenuItem>
                <Home />
                Open
                <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem checked>
                Skip breaks
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Analyze again?</DialogTitle>
                <DialogDescription>
                  This replaces the current 73 rallies.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button>Analyze</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Sheet</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Rallies</SheetTitle>
                <SheetDescription>73 rallies · 5:09 of play</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>

          <Button
            variant="outline"
            onClick={() =>
              toast.success("Court saved", { description: "Analyzing next." })
            }
          >
            Toast
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast.error("Upload failed", {
                description: "Unsupported file type .txt",
              })
            }
          >
            Error toast
          </Button>
        </Row>
      </Section>
    </>
  )
}

const formSchema = z.object({
  email: z.email({ message: "Invalid email address" }),
  name: z.string().min(1),
})

function FormExample() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "not-an-email", name: "Britney" },
  })
  // Show the error state right away.
  useEffect(() => {
    form.trigger("email")
  }, [form])
  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => e.preventDefault()}
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>Shown on your profile.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  )
}
