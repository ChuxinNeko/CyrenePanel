"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<{ username: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const { data, error } = await api.api.me.get();
        if (error || !data?.success) {
          router.push("/login");
        } else {
          setProfile(data.profile as { username: string });
        }
      } catch (e) {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [router]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-white">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-zinc-950 p-8 text-zinc-100">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <div className="flex items-center gap-4">
            <span>Welcome, {profile?.username}</span>
            <Button 
              variant="outline" 
              className="text-zinc-900"
              onClick={() => {
                // Here we simply redirect to login. In a real app, you'd want an explicit logout API endpoint to clear the HTTP-only cookie.
                router.push("/login");
              }}
            >
              Logout
            </Button>
          </div>
        </header>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-zinc-900/50 border-zinc-800 text-zinc-100">
            <CardHeader>
              <CardTitle>Servers Online</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-green-500">0</div>
            </CardContent>
          </Card>
          
          <Card className="bg-zinc-900/50 border-zinc-800 text-zinc-100">
            <CardHeader>
              <CardTitle>CPU Usage</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-blue-500">12%</div>
            </CardContent>
          </Card>
          
          <Card className="bg-zinc-900/50 border-zinc-800 text-zinc-100">
            <CardHeader>
              <CardTitle>Memory Usage</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-yellow-500">2.4 GB</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
