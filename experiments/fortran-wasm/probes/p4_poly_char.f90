program p
  type :: t
    character(len=:), allocatable :: name
  end type
  class(t), allocatable :: b
  allocate(t :: b)
  b%name = "hello"
  print *, "P4 OK ", b%name
end program
